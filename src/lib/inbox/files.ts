import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxAttachments as files,
    inboxAttachmentBlobs as blobs,
    inboxChannels,
    inboxMessages,
    inboxConversations,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "./errors";

import { MAX_FILE_BYTES } from "./file-rules";
import { fileName, safeContentType } from "./file-metadata";
import { readableCustomerConversation } from "@/lib/inbox-customer-history/visibility";
import { archiveStore, verifiedArchiveBytes, type ArchiveStore } from "@/lib/inbox-archive-storage/store";
export { fileName, safeContentType } from "./file-metadata";
export { MAX_FILE_BYTES, MAX_MESSAGE_FILES } from "./file-rules";
export type FileScope = {
    orgId: string;
    channelId: number;
    conversationId: string | null;
    ownerKey: string;
    publicOnly: boolean;
    readOnly?: boolean;
    customer?: { id: string; externalId: string; workspaceId: number };
};
export const fileOwner = (value: string) =>
    createHash("sha256").update(value).digest("hex");
export const fileColumns = {
    id: files.id,
    fileName: files.fileName,
    contentType: files.contentType,
    size: files.size,
    importMetadata: files.importMetadata,
};
function publicAttachedFile() {
    // Qualify outer columns explicitly: one-table SELECTs otherwise unqualify
    // nested SQL references and can accidentally bind the inner table's id.
    const attachmentId = sql.raw('"inbox_attachments"."id"');
    const messageId = sql.raw('"inbox_attachments"."message_id"');
    return sql`${files.kind} in ('customer','reply')
        and ("inbox_attachments"."storage_object_key" is not null or exists(select 1 from inbox_attachment_blobs b where b.attachment_id=${attachmentId}))
        and exists(
            select 1 from inbox_messages m
            join inbox_conversations c on c.id=m.conversation_id
            join inbox_channels channel on channel.id=c.channel_id
            where m.id=${messageId} and m.kind in ('customer','reply')
            and (not c.history_only or exists(
                select 1 from customer_import_files current_file
                where current_file.attachment_id=${attachmentId}
                and current_file.message_id=m.id
                and current_file.org_id=c.org_id
                and current_file.workspace_id=channel.workspace_id
                and current_file.active=true and current_file.metadata_valid=true
                and current_file.state='ready'
            ))
        )`;
}
export function attachmentQuotaBytes() {
    const configured = Number(process.env.INBOX_ATTACHMENT_QUOTA_MB ?? 2048);
    return (
        (Number.isFinite(configured)
            ? Math.min(102400, Math.max(20, configured))
            : 2048) *
        1024 *
        1024
    );
}
/** 상담창별 첨부 저장 한도 합산(업로드 한도 검사와 설정 화면 사용량 표시가 같은 조건을 쓴다). */
function channelUsageQuery(exec: DbExec, channelId: number, ownerKey = "") {
    return exec
        .select({
            bytes: sql<number>`coalesce(sum(${files.size}),0)`.mapWith(Number),
            drafts: sql<number>`count(*) FILTER (WHERE ${files.ownerKey} = ${ownerKey} AND ${files.messageId} IS NULL)`.mapWith(
                Number,
            ),
        })
        .from(files)
        .where(
            and(
                eq(files.channelId, channelId),
                isNull(files.cancelledAt),
                isNull(files.storageObjectKey),
            ),
        );
}
/** 사이트 상담창 설정에 보여줄 첨부 사용량. 호출부가 채널 관리 권한을 먼저 확인한다. */
export async function channelAttachmentUsage(channelId: number, exec: DbExec = db) {
    const [usage] = await channelUsageQuery(exec, channelId);
    return { usedBytes: usage?.bytes ?? 0, quotaBytes: attachmentQuotaBytes() };
}
export async function uploadAttachment(
    scope: FileScope,
    raw: { clientId: string; kind: string; fileName: string; bytes: Buffer },
    exec: DbExec = db,
) {
    if (scope.readOnly)
        throw new InboxError("과거 상담 기록에는 새 파일을 올릴 수 없습니다.", 409);
    const clientId = z.string().uuid().parse(raw.clientId),
        kind = z.enum(["customer", "reply", "note"]).parse(raw.kind);
    if (scope.publicOnly && kind !== "customer")
        throw new InboxError("고객 파일만 보낼 수 있습니다.", 403);
    if (!raw.bytes.length || raw.bytes.length > MAX_FILE_BYTES)
        throw new InboxError(
            "파일은 0바이트보다 크고 20MB 이하여야 합니다.",
            413,
        );
    const digest = createHash("sha256").update(raw.bytes).digest("hex"),
        name = fileName(raw.fileName),
        contentType = safeContentType(raw.bytes);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: inboxChannels.id })
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.id, scope.channelId),
                    eq(inboxChannels.orgId, scope.orgId),
                ),
            )
            .for("update");
        if (scope.conversationId) {
            const [conversation] = await tx
                .select({ historyOnly: inboxConversations.historyOnly })
                .from(inboxConversations)
                .where(eq(inboxConversations.id, scope.conversationId));
            if (conversation?.historyOnly)
                throw new InboxError(
                    "과거 상담 기록에는 새 파일을 올릴 수 없습니다.",
                    409,
                );
        }
        if (scope.publicOnly && scope.conversationId) {
            const [chat] = await tx
                .select()
                .from(inboxConversations)
                .where(eq(inboxConversations.id, scope.conversationId));
            if (
                !chat ||
                chat.mergedIntoId ||
                (!chat.contactId && !!chat.identifiedAt) ||
                (chat.contactId &&
                    scope.ownerKey !==
                        fileOwner(
                            `member:${scope.channelId}:${chat.contactId}`,
                        ))
            )
                throw new InboxError(
                    "상담 연결이 변경되었습니다. 파일을 다시 선택해주세요.",
                    409,
                );
        }
        const [duplicate] = await tx
            .select()
            .from(files)
            .where(
                and(
                    eq(files.channelId, scope.channelId),
                    eq(files.ownerKey, scope.ownerKey),
                    eq(files.clientId, clientId),
                ),
            );
        if (duplicate) {
            if (
                duplicate.cancelledAt ||
                (duplicate.expiresAt && duplicate.expiresAt <= new Date())
            )
                throw new InboxError(
                    "첨부가 만료되거나 취소되었습니다. 파일을 다시 선택해주세요.",
                    410,
                );
            if (
                duplicate.sha256 !== digest ||
                duplicate.fileName !== name ||
                duplicate.kind !== kind ||
                !!(
                    duplicate.draftConversationId &&
                    duplicate.draftConversationId !== scope.conversationId
                )
            )
                throw new InboxError("이미 사용한 첨부 번호입니다.", 409);
            return {
                id: duplicate.id,
                fileName: duplicate.fileName,
                contentType: duplicate.contentType,
                size: duplicate.size,
            };
        }
        const expired = await tx
            .update(files)
            .set({ cancelledAt: new Date() })
            .where(
                and(
                    eq(files.channelId, scope.channelId),
                    isNull(files.messageId),
                    isNull(files.cancelledAt),
                    lte(files.expiresAt, new Date()),
                ),
            )
            .returning({ id: files.id });
        if (expired.length)
            await tx.delete(blobs).where(
                inArray(
                    blobs.attachmentId,
                    expired.map((f) => f.id),
                ),
            );
        const [usage] = await channelUsageQuery(tx, scope.channelId, scope.ownerKey);
        const quota = attachmentQuotaBytes();
        if (usage.bytes + raw.bytes.length > quota)
            throw new InboxError(
                // 고객에게는 운영 내부 사정 대신 지금 할 수 있는 일을, 직원에게는 확인 위치를 안내한다.
                scope.publicOnly
                    ? "지금은 파일을 보낼 수 없습니다. 파일 없이 메시지로 내용을 남겨주시면 상담원이 안내해드립니다."
                    : "이 상담창의 파일 저장 한도에 도달했습니다. 사이트 상담창 설정에서 사용량을 확인하고 운영 관리자에게 한도 조정을 요청해주세요.",
                413,
            );
        if (usage.drafts >= 20)
            throw new InboxError(
                "미전송 첨부가 많습니다. 기존 파일을 전송하거나 삭제해주세요.",
                429,
            );
        const [inserted] = await tx
            .insert(files)
            .values({
                orgId: scope.orgId,
                channelId: scope.channelId,
                draftConversationId: scope.conversationId,
                ownerKey: scope.ownerKey,
                clientId,
                kind,
                fileName: name,
                contentType,
                size: raw.bytes.length,
                sha256: digest,
                expiresAt: new Date(Date.now() + 86400000),
            })
            .returning(fileColumns);
        await tx
            .insert(blobs)
            .values({ attachmentId: inserted.id, bytes: raw.bytes });
        return inserted;
    });
}
export async function cancelAttachment(
    scope: FileScope,
    id: string,
    exec: DbExec = db,
) {
    if (scope.readOnly)
        throw new InboxError("과거 상담 기록의 첨부는 변경할 수 없습니다.", 409);
    z.string().uuid().parse(id);
    return exec.transaction(async (tx) => {
        const [row] = await tx
            .select()
            .from(files)
            .where(
                and(
                    eq(files.id, id),
                    eq(files.orgId, scope.orgId),
                    eq(files.channelId, scope.channelId),
                    eq(files.ownerKey, scope.ownerKey),
                ),
            )
            .for("update");
        if (
            !row ||
            (scope.publicOnly && row.kind !== "customer") ||
            (row.draftConversationId &&
                row.draftConversationId !== scope.conversationId)
        )
            throw new InboxError("첨부 파일을 찾을 수 없습니다.", 404);
        if (row.messageId)
            throw new InboxError(
                "이미 전송한 파일은 초안에서 삭제할 수 없습니다.",
                409,
            );
        await tx
            .update(files)
            .set({ cancelledAt: new Date() })
            .where(eq(files.id, id));
        await tx.delete(blobs).where(eq(blobs.attachmentId, id));
        return { cancelled: true };
    });
}
async function readableAttachment(
    scope: FileScope,
    id: string,
    exec: DbExec = db,
) {
    z.string().uuid().parse(id);
    if (scope.readOnly && (!scope.customer || !scope.conversationId))
        throw new InboxError("첨부 파일을 찾을 수 없습니다.", 404);
    const readable =
        scope.publicOnly && scope.readOnly && scope.customer
            ? await readableCustomerConversation(
                  { id: scope.channelId, orgId: scope.orgId, workspaceId: scope.customer.workspaceId },
                  scope.customer,
                  exec,
              )
            : undefined;
    const [row] = await exec
        .select({
            file: files,
            bytes: blobs.bytes,
            conversationId: inboxMessages.conversationId,
            kind: inboxMessages.kind,
            chat: inboxConversations,
        })
        .from(files)
        .leftJoin(blobs, eq(blobs.attachmentId, files.id))
        .leftJoin(inboxMessages, eq(inboxMessages.id, files.messageId))
        .leftJoin(
            inboxConversations,
            eq(
                inboxConversations.id,
                scope.conversationId ?? "00000000-0000-0000-0000-000000000000",
            ),
        )
        .where(
            and(
                eq(files.id, id),
                eq(files.orgId, scope.orgId),
                eq(files.channelId, scope.channelId),
                isNull(files.cancelledAt),
                readable,
                scope.readOnly ? sql`${files.messageId} is not null` : undefined,
                scope.publicOnly
                    ? sql`(${files.messageId} is null or (${publicAttachedFile()}))`
                    : undefined,
            ),
        );
    if (
        !row || (!row.bytes && !row.file.storageObjectKey) ||
        (scope.publicOnly &&
            scope.conversationId &&
            (!row.chat ||
                row.chat.mergedIntoId ||
                (row.chat.historyOnly && !scope.readOnly) ||
                (row.chat.contactId
                    ? scope.ownerKey !==
                      fileOwner(
                          `member:${scope.channelId}:${row.chat.contactId}`,
                      )
                    : !!row.chat.identifiedAt))) ||
        (row.file.messageId
            ? row.conversationId !== scope.conversationId ||
              (scope.publicOnly &&
                  (row.kind === "note" || row.file.kind === "note"))
            : row.file.ownerKey !== scope.ownerKey ||
              !!(
                  row.file.draftConversationId &&
                  row.file.draftConversationId !== scope.conversationId
              ) ||
              !!(row.file.expiresAt && row.file.expiresAt <= new Date()))
    )
        throw new InboxError("첨부 파일을 찾을 수 없습니다.", 404);
    return row;
}
/** Existing small-file callers keep their Buffer contract. HTTP uses the streaming path below. */
export async function downloadAttachment(scope: FileScope, id: string, exec: DbExec = db) {
    const row = await readableAttachment(scope, id, exec);
    if (!row.bytes)
        throw new InboxError("보관 파일은 상담의 다운로드 링크를 이용해주세요.", 409);
    return { fileName: row.file.fileName, contentType: row.file.contentType, bytes: row.bytes };
}
export async function downloadAttachmentStream(
    scope: FileScope, id: string, exec: DbExec = db, store?: ArchiveStore,
) {
    // Authenticate and scope-check before touching object storage.
    const row = await readableAttachment(scope, id, exec);
    if (!row.file.storageObjectKey) return {
        fileName: row.file.fileName, contentType: row.file.contentType,
        size: row.file.size, body: new Uint8Array(row.bytes!),
    };
    const saved = await (store ?? archiveStore()).get(row.file.storageObjectKey);
    if (saved.size !== row.file.size) throw new InboxError("보관 파일의 크기가 다릅니다.", 502);
    const iterator = verifiedArchiveBytes({ size: row.file.size, sha256: row.file.sha256, open: () => saved.body })[Symbol.asyncIterator]();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(new Uint8Array(next.value)); }
            catch { controller.error(new Error("보관 파일을 읽는 중 검증에 실패했습니다.")); await iterator.return?.(); }
        },
        async cancel() { await iterator.return?.(); },
    });
    return { fileName: row.file.fileName, contentType: row.file.contentType, size: row.file.size, body };
}
// Called inside the message transaction, after the conversation lock.
export async function bindAttachments(
    tx: DbExec,
    scope: FileScope,
    kind: string,
    ids: string[],
    messageId: number,
) {
    if (!ids.length) return [];
    const rows = await tx
        .select()
        .from(files)
        .where(inArray(files.id, [...ids].sort()))
        .orderBy(files.id)
        .for("update");
    if (
        rows.length !== ids.length ||
        rows.some(
            (f) =>
                f.orgId !== scope.orgId ||
                f.channelId !== scope.channelId ||
                f.ownerKey !== scope.ownerKey ||
                f.kind !== kind ||
                f.messageId !== null ||
                !!f.cancelledAt ||
                !!(f.expiresAt && f.expiresAt <= new Date()) ||
                !!(
                    f.draftConversationId &&
                    f.draftConversationId !== scope.conversationId
                ),
        )
    )
        throw new InboxError(
            "보낼 수 없는 첨부입니다. 만료된 파일은 다시 선택해주세요.",
            409,
        );
    await tx
        .update(files)
        .set({ messageId, expiresAt: null })
        .where(inArray(files.id, ids));
    return rows.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        size: f.size,
    }));
}
export async function messageAttachments(exec: DbExec, ids: number[], publicOnly = false) {
    if (!ids.length) return [];
    return exec
        .select({ ...fileColumns, messageId: files.messageId })
        .from(files)
        .where(and(inArray(files.messageId, ids), isNull(files.cancelledAt), publicOnly ? publicAttachedFile() : undefined))
        .orderBy(files.createdAt, files.id);
}
