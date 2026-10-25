import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
    inboxMailboxes as boxes,
    inboxEmailThreads as threads,
    inboxEmailDeliveries as deliveries,
    inboxEmailReceipts as receipts,
    inboxMessages,
    inboxGoogleConnections,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { messageAttachments } from "@/lib/inbox/files";
import { emailFileDetails, MAX_EMAIL_REPLY_BYTES } from "./files";
import {
    type EmailReplySelection,
    resolveRecipients,
    replyRecipients,
    uniqueEmails,
} from "./recipients";
import { inboundInput } from "./rules";
import { googleAccountAddress } from "./google-identity";
import {
    checkEmailSubmission,
    EMAIL_SEND_BLOCKED,
} from "@/lib/email-send-guard";
import { isOrganizationUnsubscribed } from "@/lib/email-unsubscribe";
import { googleMailWorkerEnabled } from "./google-config";
export function replyRequestFingerprint(selection?: EmailReplySelection) {
    return createHash("sha256")
        .update(
            JSON.stringify(
                selection
                    ? {
                          mode: selection.mode,
                          sourceMessageId: selection.sourceMessageId,
                          ...(selection.mode === "custom"
                              ? {
                                    to: uniqueEmails(selection.to ?? []).sort(),
                                    cc: uniqueEmails(selection.cc ?? []).sort(),
                                }
                              : {}),
                      }
                    : null,
            ),
        )
        .digest("hex");
}
export async function assertEmailReplyDuplicate(
    exec: DbExec,
    messageId: number,
    selection?: EmailReplySelection,
) {
    const [row] = await exec
        .select({ fingerprint: deliveries.requestFingerprint })
        .from(deliveries)
        .where(eq(deliveries.messageId, messageId));
    if (
        !row ||
        (row.fingerprint === null
            ? !selection
            : row.fingerprint === replyRequestFingerprint(selection))
    )
        return;
    throw new InboxError(
        "같은 메시지 번호의 받는 사람 또는 회신 대상이 변경됐습니다.",
        409,
    );
}
async function replySource(exec: DbExec, conversationId: string) {
    const [row] = await exec
        .select({ thread: threads, mailbox: boxes, connectionStatus: inboxGoogleConnections.status })
        .from(threads)
        .innerJoin(boxes, eq(boxes.id, threads.mailboxId))
        .leftJoin(inboxGoogleConnections, eq(inboxGoogleConnections.mailboxId, boxes.id))
        .where(eq(threads.conversationId, conversationId));
    if (!row) throw new InboxError("메일 상담 정보를 찾을 수 없습니다.", 404);
    const lookup = (messageId?: number) =>
        exec
            .select({
                envelope: receipts.envelope,
                messageId: receipts.messageId,
            })
            .from(receipts)
            .innerJoin(inboxMessages, eq(inboxMessages.id, receipts.messageId))
            .where(
                and(
                    messageId ? eq(receipts.messageId, messageId) : undefined,
                    eq(receipts.mailboxId, row.mailbox.id),
                    eq(inboxMessages.conversationId, conversationId),
                    sql`${receipts.envelope}->>'rfcMessageId'=${row.thread.lastRfcMessageId}`,
                ),
            )
            .orderBy(desc(receipts.messageId))
            .limit(1);
    let [receipt] = row.thread.lastInboundMessageId
        ? await lookup(row.thread.lastInboundMessageId)
        : [];
    if (!receipt) [receipt] = await lookup();
    const envelope = receipt
        ? inboundInput.parse(receipt.envelope)
        : { from: row.thread.correspondent, to: [row.mailbox.address], cc: [] };
    return { ...row, envelope, sourceMessageId: receipt?.messageId ?? null };
}
export async function emailConversationContext(
    exec: DbExec,
    conversationId: string,
) {
    const row = await replySource(exec, conversationId),
        reply = replyRecipients(row.envelope, row.mailbox.address, "reply", [
            googleAccountAddress(row.mailbox),
        ]),
        all = replyRecipients(row.envelope, row.mailbox.address, "reply_all", [
            googleAccountAddress(row.mailbox),
        ]);
    return {
        subject: row.thread.subject,
        recipient: reply.to[0] ?? row.thread.correspondent,
        from: row.mailbox.address,
        enabled: row.mailbox.enabled,
        connectionStatus: row.connectionStatus,
        workerEnabled: row.connectionStatus ? googleMailWorkerEnabled() : undefined,
        sourceMessageId: row.sourceMessageId,
        sender: row.envelope.from,
        primarySender: row.thread.correspondent,
        replyTo: reply.to,
        replyAllTo: all.to,
        replyAllCc: all.cc,
    };
}
export async function queueEmailReply(
    exec: DbExec,
    conversationId: string,
    messageId: number,
    attachmentCount: number,
    selection?: EmailReplySelection,
) {
    if (attachmentCount) {
        const files = await messageAttachments(exec, [messageId]);
        if (
            files.reduce((sum, file) => sum + file.size, 0) >
            MAX_EMAIL_REPLY_BYTES
        )
            throw new InboxError(
                "이메일 답장 첨부는 합계 20MB까지 보낼 수 있습니다.",
                413,
            );
    }
    const row = await replySource(exec, conversationId);
    if (!row || !row.mailbox.enabled)
        throw new InboxError(
            "이 메일함의 수신·발송 연결이 중지되어 있습니다.",
            409,
        );
    if (selection && selection.sourceMessageId !== row.sourceMessageId)
        throw new InboxError(
            "새 메일이 도착했습니다. 최신 회신 대상과 받는 사람을 다시 확인해주세요.",
            409,
        );
    let recipients;
    try {
        recipients = resolveRecipients(
            row.envelope,
            row.mailbox.address,
            selection,
            [googleAccountAddress(row.mailbox)],
        );
    } catch (e) {
        throw new InboxError((e as Error).message);
    }
    const decision = await checkEmailSubmission(
        row.mailbox.orgId,
        [...recipients.to, ...recipients.cc],
        (orgId, email) => isOrganizationUnsubscribed(orgId, email, exec),
    );
    if (!decision.allowed)
        throw new InboxError(
            decision.blockedRecipients?.length
                ? `수신거부 목록에 등록된 주소가 있어 메일을 보내지 않았습니다. 받는 사람·참조에서 빼주세요: ${decision.blockedRecipients.join(", ")}`
                : decision.rejection.header.resultMessage,
            decision.rejection.header.resultCode === EMAIL_SEND_BLOCKED
                ? 409
                : 503,
        );
    const id = randomUUID();
    await exec.insert(deliveries).values({
        id,
        mailboxId: row.mailbox.id,
        mailboxVersion: row.mailbox.version,
        messageId,
        recipient: recipients.to[0],
        recipientTo: recipients.to,
        recipientCc: recipients.cc,
        replyMode: selection?.mode ?? "reply",
        sourceMessageId: row.sourceMessageId,
        requestFingerprint: replyRequestFingerprint(selection),
        subject: row.thread.subject,
        providerThreadId: row.thread.providerThreadId,
        inReplyTo: row.thread.lastRfcMessageId,
        rfcMessageId: `<${id}@${row.mailbox.address.split("@")[1]}>`,
    });
}
export async function emailMessageDetails(exec: DbExec, ids: number[]) {
    if (!ids.length) return { incoming: [], outgoing: [] };
    const [incoming, outgoing, fileStates] = await Promise.all([
        exec
            .select({
                messageId: receipts.messageId,
                envelope: receipts.envelope,
            })
            .from(receipts)
            .where(inArray(receipts.messageId, ids)),
        exec
            .select({
                id: deliveries.id,
                messageId: deliveries.messageId,
                state: deliveries.state,
                recipient: deliveries.recipient,
                recipientTo: deliveries.recipientTo,
                recipientCc: deliveries.recipientCc,
                replyMode: deliveries.replyMode,
                sourceMessageId: deliveries.sourceMessageId,
                sentAt: deliveries.sentAt,
                errorCode: deliveries.errorCode,
            })
            .from(deliveries)
            .where(inArray(deliveries.messageId, ids)),
        emailFileDetails(exec, ids),
    ]);
    const byFile = new Map(
        fileStates.map((state) => [
            `${state.messageId}:${state.fileIndex}`,
            state,
        ]),
    );
    return {
        incoming: incoming.map((row) => ({
            ...row,
            envelope: {
                ...row.envelope,
                files: (Array.isArray(row.envelope.files)
                    ? row.envelope.files
                    : []
                ).map((file, index) => ({
                    ...(file && typeof file === "object" ? file : {}),
                    ...byFile.get(`${row.messageId}:${index}`),
                })),
            },
        })),
        outgoing: outgoing.map((row) => ({
            ...row,
            recipientTo: row.recipientTo ?? [row.recipient],
        })),
    };
}
