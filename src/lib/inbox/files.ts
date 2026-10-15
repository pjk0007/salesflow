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
export { fileName, safeContentType } from "./file-metadata";
export { MAX_FILE_BYTES, MAX_MESSAGE_FILES } from "./file-rules";
export type FileScope = {
    orgId: string;
    channelId: number;
    conversationId: string | null;
    ownerKey: string;
    publicOnly: boolean;
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
export async function uploadAttachment(
    scope: FileScope,
    raw: { clientId: string; kind: string; fileName: string; bytes: Buffer },
    exec: DbExec = db,
) {
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
        const [usage] = await tx
            .select({
                bytes: sql<number>`coalesce(sum(${files.size}),0)`.mapWith(
                    Number,
                ),
                drafts: sql<number>`count(*) FILTER (WHERE ${files.ownerKey} = ${scope.ownerKey} AND ${files.messageId} IS NULL)`.mapWith(
                    Number,
                ),
            })
            .from(files)
            .where(
                and(
                    eq(files.channelId, scope.channelId),
                    isNull(files.cancelledAt),
                ),
            );
        const quota = attachmentQuotaBytes();
        if (usage.bytes + raw.bytes.length > quota)
            throw new InboxError(
                "이 사업의 상담 파일 저장 한도에 도달했습니다. 관리자에게 문의해주세요.",
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
export async function downloadAttachment(
    scope: FileScope,
    id: string,
    exec: DbExec = db,
) {
    z.string().uuid().parse(id);
    const [row] = await exec
        .select({
            file: files,
            bytes: blobs.bytes,
            conversationId: inboxMessages.conversationId,
            kind: inboxMessages.kind,
            chat: inboxConversations,
        })
        .from(files)
        .innerJoin(blobs, eq(blobs.attachmentId, files.id))
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
            ),
        );
    if (
        !row ||
        (scope.publicOnly &&
            scope.conversationId &&
            (!row.chat ||
                row.chat.mergedIntoId ||
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
    return {
        fileName: row.file.fileName,
        contentType: row.file.contentType,
        bytes: row.bytes,
    };
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
export async function messageAttachments(exec: DbExec, ids: number[]) {
    if (!ids.length) return [];
    return exec
        .select({ ...fileColumns, messageId: files.messageId })
        .from(files)
        .where(and(inArray(files.messageId, ids), isNull(files.cancelledAt)))
        .orderBy(files.createdAt, files.id);
}
