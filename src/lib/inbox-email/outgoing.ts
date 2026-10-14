import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
    inboxMailboxes as boxes,
    inboxEmailThreads as threads,
    inboxEmailDeliveries as deliveries,
    inboxEmailReceipts as receipts,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
export async function queueEmailReply(
    exec: DbExec,
    conversationId: string,
    messageId: number,
    attachmentCount: number,
) {
    if (attachmentCount)
        throw new InboxError(
            "이메일 답장은 현재 텍스트만 지원합니다. 첨부 파일을 제거해주세요.",
            409,
        );
    const [row] = await exec
        .select({ thread: threads, mailbox: boxes })
        .from(threads)
        .innerJoin(boxes, eq(boxes.id, threads.mailboxId))
        .where(eq(threads.conversationId, conversationId));
    if (!row || !row.mailbox.enabled)
        throw new InboxError(
            "이 메일함의 수신·발송 연결이 중지되어 있습니다.",
            409,
        );
    const id = randomUUID();
    await exec
        .insert(deliveries)
        .values({
            id,
            mailboxId: row.mailbox.id,
            mailboxVersion: row.mailbox.version,
            messageId,
            recipient: row.thread.correspondent,
            subject: row.thread.subject,
            providerThreadId: row.thread.providerThreadId,
            inReplyTo: row.thread.lastRfcMessageId,
            rfcMessageId: `<${id}@${row.mailbox.address.split("@")[1]}>`,
        });
}
export async function emailMessageDetails(exec: DbExec, ids: number[]) {
    if (!ids.length) return { incoming: [], outgoing: [] };
    const [incoming, outgoing] = await Promise.all([
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
                sentAt: deliveries.sentAt,
                errorCode: deliveries.errorCode,
            })
            .from(deliveries)
            .where(inArray(deliveries.messageId, ids)),
    ]);
    return { incoming, outgoing };
}
