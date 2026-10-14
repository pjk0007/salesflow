import { checkGoogleGuard } from "./google-guard";
import { and, eq, asc, desc, sql, inArray } from "drizzle-orm";
import {
    db,
    inboxEmailFiles as emailFiles,
    inboxEmailReceipts as receipts,
    inboxMailboxes as boxes,
    inboxMessages as messages,
    inboxConversations as chats,
    inboxEmailDeliveries as deliveries,
    inboxAttachments as attachments,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { InboxError } from "@/lib/inbox/errors";
import {
    uploadAttachment,
    bindAttachments,
    fileOwner,
    MAX_FILE_BYTES,
    type FileScope,
} from "@/lib/inbox/files";
import { appendActivity } from "@/lib/customer-platform/activities";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { inboundInput, type InboundEmail } from "./rules";
type Actor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
export const MAX_EMAIL_REPLY_BYTES = MAX_FILE_BYTES;
export async function seedEmailFiles(
    exec: DbExec,
    receiptId: string,
    files: InboundEmail["files"],
) {
    if (!files.length) return;
    await exec
        .insert(emailFiles)
        .values(
            files.map((file, fileIndex) => ({
                receiptId,
                fileIndex,
                state:
                    file.size > MAX_FILE_BYTES || !file.size
                        ? "blocked"
                        : "pending",
                errorCode:
                    file.size > MAX_FILE_BYTES
                        ? "too_large"
                        : !file.size
                          ? "empty_file"
                          : null,
            })),
        )
        .onConflictDoNothing();
}
export async function ownedEmailReceipt(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const [row] = await exec
        .select({ receipt: receipts, box: boxes })
        .from(receipts)
        .innerJoin(boxes, eq(boxes.id, receipts.mailboxId))
        .where(and(eq(receipts.id, id), eq(boxes.orgId, actor.orgId)));
    if (!row) throw new InboxError("수신 메일을 찾을 수 없습니다.", 404);
    return row;
}
export async function listEmailReceiptFiles(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const { receipt } = await ownedEmailReceipt(actor, id, exec);
    const metadata = inboundInput.parse(receipt.envelope).files;
    const rows = await exec
        .select()
        .from(emailFiles)
        .where(eq(emailFiles.receiptId, id))
        .orderBy(asc(emailFiles.fileIndex));
    return rows.map((file) => ({
        ...file,
        ...metadata[file.fileIndex],
        providerMessageId: receipt.providerMessageId,
    }));
}
export async function pendingEmailFiles(
    actor: Actor,
    mailboxId: string,
    before?: string,
    exec: DbExec = db,
) {
    const [box] = await exec
        .select()
        .from(boxes)
        .where(and(eq(boxes.id, mailboxId), eq(boxes.orgId, actor.orgId)));
    if (!box) throw new InboxError("메일함을 찾을 수 없습니다.", 404);
    const rows = await exec
        .select({ file: emailFiles, receipt: receipts })
        .from(emailFiles)
        .innerJoin(receipts, eq(receipts.id, emailFiles.receiptId))
        .where(
            and(
                eq(receipts.mailboxId, mailboxId),
                inArray(emailFiles.state, ["pending", "failed"]),
                before ? sql`${emailFiles.id}<${before}` : undefined,
            ),
        )
        .orderBy(desc(emailFiles.id))
        .limit(50);
    return {
        rows: rows.map(({ file, receipt }) => ({
            ...file,
            ...inboundInput.parse(receipt.envelope).files[file.fileIndex],
            providerMessageId: receipt.providerMessageId,
        })),
        hasMore: rows.length === 50,
    };
}
export async function retryEmailFile(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const hint = await ownedEmailFile(actor, id, exec);
    return exec.transaction(async (tx) => {
        const [box] = await tx
            .select()
            .from(boxes)
            .where(eq(boxes.id, hint.box.id))
            .for("update");
        if (!box.enabled)
            throw new InboxError("메일함 연결을 켠 뒤 다시 요청해주세요.", 409);
        const [item] = await tx
            .select()
            .from(emailFiles)
            .where(eq(emailFiles.id, id))
            .for("update");
        if (item.state !== "failed")
            throw new InboxError(
                "가져오기에 실패한 파일만 다시 요청할 수 있습니다.",
                409,
            );
        const [saved] = await tx
            .update(emailFiles)
            .set({ state: "pending", errorCode: null })
            .where(eq(emailFiles.id, id))
            .returning();
        return saved;
    });
}
export async function ownedEmailFile(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const [row] = await exec
        .select({
            file: emailFiles,
            receipt: receipts,
            box: boxes,
            conversationId: messages.conversationId,
            medium: chats.medium,
            chatOrg: chats.orgId,
            chatChannel: chats.channelId,
        })
        .from(emailFiles)
        .innerJoin(receipts, eq(receipts.id, emailFiles.receiptId))
        .innerJoin(boxes, eq(boxes.id, receipts.mailboxId))
        .innerJoin(messages, eq(messages.id, receipts.messageId))
        .innerJoin(chats, eq(chats.id, messages.conversationId))
        .where(and(eq(emailFiles.id, id), eq(boxes.orgId, actor.orgId)));
    if (
        !row ||
        row.medium !== "email" ||
        row.chatOrg !== actor.orgId ||
        row.chatChannel !== row.box.channelId
    )
        throw new InboxError("메일 첨부를 찾을 수 없습니다.", 404);
    const metadata = inboundInput.parse(row.receipt.envelope).files[
        row.file.fileIndex
    ];
    if (!metadata) throw new InboxError("원본 첨부 정보가 없습니다.", 409);
    return { ...row, metadata };
}
export async function storeEmailFile(
    actor: Actor,
    id: string,
    bytes: Buffer,
    exec: DbExec = db,
    expectedConnectionVersion?: number,
) {
    const hint = await ownedEmailFile(actor, id, exec);
    if (!hint.box.enabled)
        throw new InboxError("메일함 연결이 중지되어 있습니다.", 409);
    if (hint.file.state === "blocked")
        throw new InboxError(
            "이 파일은 상담 파일의 크기 제한을 넘거나 비어 있습니다. 원본 메일함에서 확인해주세요.",
            413,
        );
    if (bytes.length !== hint.metadata.size)
        throw new InboxError(
            "원본 첨부와 내려받은 파일의 크기가 다릅니다.",
            409,
        );
    const scope: FileScope = {
        orgId: actor.orgId,
        channelId: hint.box.channelId,
        conversationId: hint.conversationId,
        ownerKey: fileOwner(`email:${hint.box.id}`),
        publicOnly: false,
    };
    return exec.transaction(async (tx) => {
        // uploadAttachment takes the channel quota lock first. Preserve channel→mailbox→conversation→file order.
        const uploaded = await uploadAttachment(
            scope,
            {
                clientId: id,
                kind: "customer",
                fileName: hint.metadata.name,
                bytes,
            },
            tx,
        );
        const [box] = await tx
            .select()
            .from(boxes)
            .where(and(eq(boxes.id, hint.box.id), eq(boxes.orgId, actor.orgId)))
            .for("update");
        if (!box?.enabled)
            throw new InboxError("메일함 연결이 중지되어 있습니다.", 409);
        await checkGoogleGuard(tx, box.id, expectedConnectionVersion);
        await tx
            .select({ id: chats.id })
            .from(chats)
            .where(eq(chats.id, hint.conversationId))
            .for("update");
        const [current] = await tx
            .select()
            .from(emailFiles)
            .where(eq(emailFiles.id, id))
            .for("update");
        if (current.state === "available")
            return {
                ...current,
                ...hint.metadata,
                providerMessageId: hint.receipt.providerMessageId,
                attachment: uploaded,
            };
        await bindAttachments(
            tx,
            scope,
            "customer",
            [uploaded.id],
            hint.receipt.messageId!,
        );
        const [saved] = await tx
            .update(emailFiles)
            .set({
                attachmentId: uploaded.id,
                state: "available",
                errorCode: null,
            })
            .where(eq(emailFiles.id, id))
            .returning();
        const key = `email-file:${id}:available`,
            summary = `메일 첨부 수신 · ${uploaded.fileName}`;
        const [chat] = await tx
            .select({ contactId: chats.contactId })
            .from(chats)
            .where(eq(chats.id, hint.conversationId));
        if (chat.contactId)
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId: box.workspaceId,
                contactId: chat.contactId,
                source: "conversation",
                entityId: hint.conversationId,
                eventKey: key,
                action: "email.attachment",
                summary,
                actorName: actor.name,
                metadata: {
                    conversationId: hint.conversationId,
                    messageId: hint.receipt.messageId,
                    attachment: uploaded,
                },
                occurredAt: new Date(),
            });
        await enqueuePlatformEvent(tx, {
            orgId: actor.orgId,
            workspaceId: box.workspaceId,
            key,
            type: "conversation.updated",
            data: {
                conversationId: hint.conversationId,
                contactId: chat.contactId,
                action: "email.attachment.received",
                messageId: hint.receipt.messageId,
                attachment: uploaded,
            },
        });
        return {
            ...saved,
            ...hint.metadata,
            providerMessageId: hint.receipt.providerMessageId,
            attachment: uploaded,
        };
    });
}
export async function failEmailFile(
    actor: Actor,
    id: string,
    errorCode: "download_failed" | "source_missing" | "size_mismatch",
    exec: DbExec = db,
    expectedConnectionVersion?: number,
) {
    const hint = await ownedEmailFile(actor, id, exec);
    return exec.transaction(async (tx) => {
        const [box] = await tx
            .select()
            .from(boxes)
            .where(eq(boxes.id, hint.box.id))
            .for("update");
        if (!box.enabled)
            throw new InboxError("메일함 연결이 중지되어 있습니다.", 409);
        await checkGoogleGuard(tx, box.id, expectedConnectionVersion);
        const [current] = await tx
            .select()
            .from(emailFiles)
            .where(eq(emailFiles.id, id))
            .for("update");
        if (["available", "blocked"].includes(current.state)) return current;
        const [saved] = await tx
            .update(emailFiles)
            .set({ state: "failed", errorCode })
            .where(eq(emailFiles.id, id))
            .returning();
        return saved;
    });
}
export async function emailFileDetails(exec: DbExec, messageIds: number[]) {
    if (!messageIds.length) return [];
    return exec
        .select({
            messageId: receipts.messageId,
            id: emailFiles.id,
            fileIndex: emailFiles.fileIndex,
            state: emailFiles.state,
            attachmentId: emailFiles.attachmentId,
            errorCode: emailFiles.errorCode,
        })
        .from(emailFiles)
        .innerJoin(receipts, eq(receipts.id, emailFiles.receiptId))
        .where(inArray(receipts.messageId, messageIds));
}
export async function emailDeliveryFileScope(
    actor: Actor,
    deliveryId: string,
    fileId: string,
    leaseToken: string,
    exec: DbExec = db,
    now = new Date(),
    expectedConnectionVersion?: number,
): Promise<FileScope> {
    const [row] = await exec
        .select({
            item: deliveries,
            box: boxes,
            message: messages,
            file: attachments,
        })
        .from(deliveries)
        .innerJoin(boxes, eq(boxes.id, deliveries.mailboxId))
        .innerJoin(messages, eq(messages.id, deliveries.messageId))
        .innerJoin(
            attachments,
            and(
                eq(attachments.messageId, messages.id),
                eq(attachments.id, fileId),
            ),
        )
        .where(
            and(eq(deliveries.id, deliveryId), eq(boxes.orgId, actor.orgId)),
        );
    if (
        !row ||
        row.message.kind !== "reply" ||
        row.file.kind !== "reply" ||
        row.file.cancelledAt ||
        row.file.orgId !== actor.orgId ||
        row.file.channelId !== row.box.channelId
    )
        throw new InboxError("발송 첨부를 찾을 수 없습니다.", 404);
    if (
        !row.box.enabled ||
        row.item.mailboxVersion !== row.box.version ||
        row.item.leaseToken !== leaseToken ||
        row.item.state !== "leased" ||
        !row.item.leaseUntil ||
        row.item.leaseUntil <= now
    )
        throw new InboxError("첨부를 내려받을 발송 권한이 만료됐습니다.", 409);
    await checkGoogleGuard(exec, row.box.id, expectedConnectionVersion);
    return {
        orgId: actor.orgId,
        channelId: row.box.channelId,
        conversationId: row.message.conversationId,
        ownerKey: fileOwner(`email-relay:${row.box.id}`),
        publicOnly: false,
    };
}
