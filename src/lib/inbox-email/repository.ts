import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, lte, or, sql, asc } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    workspaces,
    inboxChannels,
    inboxConversations,
    inboxMessages,
    crmContacts,
    inboxMailboxes as boxes,
    inboxEmailThreads as threads,
    inboxEmailReceipts as receipts,
    inboxEmailDeliveries as deliveries,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { InboxError } from "@/lib/inbox/errors";
import { appendMessage } from "@/lib/inbox/repository";
import { seedEmailFiles } from "./files";
import { inboxAttachments } from "@/lib/db";
import { fileOwner } from "@/lib/inbox/files";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { appendActivity } from "@/lib/customer-platform/activities";
import {
    mailboxInput,
    mailboxPatch,
    inboundInput,
    emailFingerprint,
    ignoredEmail,
    emailContactKey,
    receiptClientId,
} from "./rules";
type Actor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
export async function ownedMailbox(
    actor: Actor,
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    const q = exec
        .select()
        .from(boxes)
        .where(and(eq(boxes.id, id), eq(boxes.orgId, actor.orgId)));
    const [box] = await (lock ? q.for("update") : q);
    if (!box) throw new InboxError("메일함을 찾을 수 없습니다.", 404);
    return box;
}
export async function listMailboxes(
    actor: Actor,
    workspaceId: number,
    exec: DbExec = db,
) {
    const [space] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
            and(
                eq(workspaces.id, workspaceId),
                eq(workspaces.orgId, actor.orgId),
            ),
        );
    if (!space) throw new InboxError("사업을 찾을 수 없습니다.", 404);
    return exec
        .select()
        .from(boxes)
        .where(
            and(
                eq(boxes.orgId, actor.orgId),
                eq(boxes.workspaceId, workspaceId),
            ),
        )
        .orderBy(boxes.createdAt);
}
export async function createMailbox(
    actor: Actor,
    raw: unknown,
    exec: DbExec = db,
) {
    if (actor.role === "member")
        throw new InboxError("관리자만 메일함을 설정할 수 있습니다.", 403);
    const input = mailboxInput.parse(raw);
    return exec.transaction(async (tx) => {
        const [channel] = await tx
            .select()
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.orgId, actor.orgId),
                    eq(inboxChannels.workspaceId, input.workspaceId),
                ),
            )
            .for("update");
        if (!channel)
            throw new InboxError("이 사업의 상담함을 먼저 만들어주세요.", 409);
        const [existing] = await tx
            .select()
            .from(boxes)
            .where(
                and(
                    eq(boxes.orgId, actor.orgId),
                    eq(boxes.address, input.address),
                ),
            );
        if (existing)
            throw new InboxError(
                "이미 등록된 메일함입니다. 기존 연결을 확인해주세요.",
                409,
            );
        const [box] = await tx
            .insert(boxes)
            .values({ ...input, channelId: channel.id, orgId: actor.orgId })
            .returning();
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: channel.id,
            actorId: actor.userId,
            actorName: actor.name,
            action: "email.mailbox.created",
            changes: {
                mailbox: {
                    before: null,
                    after: { id: box.id, address: box.address, enabled: false },
                },
            },
        });
        return box;
    });
}
export async function changeMailbox(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    if (actor.role === "member")
        throw new InboxError("관리자만 메일함을 설정할 수 있습니다.", 403);
    const input = mailboxPatch.parse(raw);
    return exec.transaction(async (tx) => {
        const box = await ownedMailbox(actor, id, tx, true);
        if (box.version !== input.version)
            throw new InboxError(
                "메일함 설정이 변경됐습니다. 새로 불러와주세요.",
                409,
            );
        if (box.enabled === input.enabled) return box;
        const [next] = await tx
            .update(boxes)
            .set({ enabled: input.enabled, version: box.version + 1 })
            .where(eq(boxes.id, id))
            .returning();
        // Anything already handed to a provider must not be represented as cancelled.
        await tx
            .update(deliveries)
            .set({
                state: "cancelled",
                errorCode: "mailbox_changed",
                leaseToken: null,
                leaseUntil: null,
            })
            .where(
                and(
                    eq(deliveries.mailboxId, id),
                    inArray(deliveries.state, ["queued", "leased"]),
                ),
            );
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: box.channelId,
            actorId: actor.userId,
            actorName: actor.name,
            action: "email.mailbox.updated",
            changes: { enabled: { before: box.enabled, after: input.enabled } },
        });
        return next;
    });
}
export async function receiveEmail(
    actor: Actor,
    mailboxId: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = inboundInput.parse(raw);
    const at = new Date(input.receivedAt);
    if (at.getTime() > Date.now() + 300000)
        throw new InboxError("수신 시간이 미래입니다.");
    return exec.transaction(async (tx) => {
        const box = await ownedMailbox(actor, mailboxId, tx, true);
        if (!box.enabled)
            throw new InboxError("메일함 연결이 중지되어 있습니다.", 409);
        if (!input.to.includes(box.address))
            throw new InboxError(
                "이 메일함으로 수신한 메일만 연결할 수 있습니다.",
                409,
            );
        const fingerprint = emailFingerprint(input);
        const [previous] = await tx
            .select()
            .from(receipts)
            .where(
                and(
                    eq(receipts.mailboxId, mailboxId),
                    eq(receipts.providerMessageId, input.providerMessageId),
                ),
            );
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw new InboxError(
                    "같은 원본 메일 번호에 다른 내용이 있습니다.",
                    409,
                );
            if (previous.messageId)
                await seedEmailFiles(tx, previous.id, input.files);
            return {
                receiptId: previous.id,
                messageId: previous.messageId,
                ignoredReason: previous.ignoredReason,
                duplicate: true,
            };
        }
        const ignoredReason = ignoredEmail(input, box.address);
        if (ignoredReason) {
            const [receipt] = await tx
                .insert(receipts)
                .values({
                    mailboxId,
                    providerMessageId: input.providerMessageId,
                    fingerprint,
                    envelope: input,
                    ignoredReason,
                })
                .returning();
            return {
                receiptId: receipt.id,
                messageId: null,
                ignoredReason,
                duplicate: false,
            };
        }
        let [thread] = await tx
            .select()
            .from(threads)
            .where(
                and(
                    eq(threads.mailboxId, mailboxId),
                    eq(threads.providerThreadId, input.providerThreadId),
                ),
            );
        // Provider thread grouping is insufficient to authorize sharing between participants.
        if (thread && thread.correspondent !== input.from)
            throw new InboxError(
                "여러 고객이 섞인 메일 스레드는 별도 확인이 필요합니다.",
                409,
            );
        if (!thread) {
            const externalId = emailContactKey(mailboxId, input.from);
            const [existingContact] = await tx
                .select({ id: crmContacts.id })
                .from(crmContacts)
                .where(
                    and(
                        eq(crmContacts.workspaceId, box.workspaceId),
                        eq(crmContacts.externalId, externalId),
                    ),
                );
            const [contact] = await tx
                .insert(crmContacts)
                .values({
                    orgId: actor.orgId,
                    workspaceId: box.workspaceId,
                    externalId,
                    name: input.fromName || input.from,
                    email: input.from,
                    attributes: { source: "email", mailboxId },
                })
                .onConflictDoUpdate({
                    target: [crmContacts.workspaceId, crmContacts.externalId],
                    set: { externalId },
                })
                .returning();
            if (!existingContact)
                await enqueuePlatformEvent(tx, {
                    orgId: actor.orgId,
                    workspaceId: box.workspaceId,
                    key: `contact:${contact.id}:created`,
                    type: "contact.created",
                    data: { contact },
                    occurredAt: at,
                });
            const [chat] = await tx
                .insert(inboxConversations)
                .values({
                    orgId: actor.orgId,
                    channelId: box.channelId,
                    medium: "email",
                    contactId: contact.id,
                    tokenHash: createHash("sha256")
                        .update(randomBytes(32))
                        .digest("hex"),
                    name: contact.name,
                    email: input.from,
                    aiState: "human",
                    aiHandoffReason:
                        "이메일 상담은 상담원이 검토한 답장만 발송합니다.",
                    lastMessageAt: at,
                    createdAt: at,
                })
                .returning();
            [thread] = await tx
                .insert(threads)
                .values({
                    conversationId: chat.id,
                    mailboxId,
                    providerThreadId: input.providerThreadId,
                    correspondent: input.from,
                    subject: input.subject,
                    lastRfcMessageId: input.rfcMessageId,
                    lastReceivedAt: at,
                })
                .returning();
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId: box.workspaceId,
                key: `conversation:${chat.id}:created`,
                type: "conversation.created",
                data: {
                    conversationId: chat.id,
                    channelId: box.channelId,
                    contactId: contact.id,
                    medium: "email",
                },
                occurredAt: at,
            });
        }
        const message = await appendMessage(
            tx,
            thread.conversationId,
            {
                clientId: receiptClientId(mailboxId, input.providerMessageId),
                kind: "customer",
                body: input.body,
                authorName: input.fromName || input.from,
                attachmentIds: [],
                sourceAttachmentCount: input.files.length,
                createdAt: at,
            },
            {
                orgId: actor.orgId,
                channelId: box.channelId,
                conversationId: thread.conversationId,
                ownerKey: fileOwner(`email:${mailboxId}`),
                publicOnly: false,
            },
        );
        if (at >= thread.lastReceivedAt)
            await tx
                .update(threads)
                .set({
                    lastRfcMessageId: input.rfcMessageId,
                    lastReceivedAt: at,
                })
                .where(eq(threads.conversationId, thread.conversationId));
        const [receipt] = await tx
            .insert(receipts)
            .values({
                mailboxId,
                providerMessageId: input.providerMessageId,
                fingerprint,
                messageId: message.id,
                envelope: input,
            })
            .returning();
        await seedEmailFiles(tx, receipt.id, input.files);
        return {
            receiptId: receipt.id,
            conversationId: thread.conversationId,
            messageId: message.id,
            ignoredReason: null,
            duplicate: false,
        };
    });
}
export async function claimEmail(
    actor: Actor,
    mailboxId: string,
    exec: DbExec = db,
    now = new Date(),
) {
    return exec.transaction(async (tx) => {
        const box = await ownedMailbox(actor, mailboxId, tx, true);
        await tx
            .update(deliveries)
            .set({ state: "uncertain", errorCode: "send_confirmation_missing" })
            .where(
                and(
                    eq(deliveries.mailboxId, mailboxId),
                    eq(deliveries.state, "sending"),
                    lte(deliveries.leaseUntil, now),
                ),
            );
        if (!box.enabled) return null;
        await tx
            .update(deliveries)
            .set({
                state: "cancelled",
                errorCode: "mailbox_changed",
                leaseToken: null,
                leaseUntil: null,
            })
            .where(
                and(
                    eq(deliveries.mailboxId, mailboxId),
                    inArray(deliveries.state, ["queued", "leased"]),
                    sql`${deliveries.mailboxVersion} <> ${box.version}`,
                ),
            );
        const [candidate] = await tx
            .select()
            .from(deliveries)
            .where(
                and(
                    eq(deliveries.mailboxId, mailboxId),
                    or(
                        eq(deliveries.state, "queued"),
                        and(
                            eq(deliveries.state, "leased"),
                            lte(deliveries.leaseUntil, now),
                        ),
                    ),
                ),
            )
            .orderBy(asc(deliveries.createdAt), asc(deliveries.id))
            .limit(1)
            .for("update");
        if (!candidate) return null;
        const [delivery] = await tx
            .update(deliveries)
            .set({
                state: "leased",
                leaseToken: randomUUID(),
                leaseUntil: new Date(now.getTime() + 120000),
            })
            .where(eq(deliveries.id, candidate.id))
            .returning();
        const [message] = await tx
            .select({
                body: inboxMessages.body,
                authorName: inboxMessages.authorName,
            })
            .from(inboxMessages)
            .where(eq(inboxMessages.id, delivery.messageId));
        const files = await tx
            .select({
                id: inboxAttachments.id,
                fileName: inboxAttachments.fileName,
                contentType: inboxAttachments.contentType,
                size: inboxAttachments.size,
                sha256: inboxAttachments.sha256,
            })
            .from(inboxAttachments)
            .where(
                and(
                    eq(inboxAttachments.messageId, delivery.messageId),
                    eq(inboxAttachments.kind, "reply"),
                    sql`${inboxAttachments.cancelledAt} IS NULL`,
                ),
            )
            .orderBy(inboxAttachments.id);
        return {
            ...delivery,
            ...message,
            attachments: files,
            from: box.address,
            fromName: box.name,
        };
    });
}
export const deliveryActionInput = z.discriminatedUnion("action", [
    z
        .object({
            action: z.literal("prepare_failed"),
            leaseToken: z.string().uuid(),
            errorCode: z.enum([
                "attachment_download",
                "attachment_changed",
                "mime_invalid",
                "mailbox_mismatch",
            ]),
        })
        .strict(),
    z
        .object({ action: z.literal("begin"), leaseToken: z.string().uuid() })
        .strict(),
    z
        .object({
            action: z.literal("sent"),
            leaseToken: z.string().uuid(),
            providerMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
        })
        .strict(),
    z
        .object({
            action: z.enum(["failed", "uncertain"]),
            leaseToken: z.string().uuid(),
            errorCode: z.enum([
                "provider_rejected",
                "auth",
                "scope",
                "rate_limited",
                "network_unknown",
                "provider_unknown",
            ]),
        })
        .strict(),
    z.object({ action: z.literal("retry") }).strict(),
    z.object({ action: z.literal("cancel") }).strict(),
]);
export async function emailDeliveryMailbox(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const [row] = await exec
        .select({ mailboxId: deliveries.mailboxId })
        .from(deliveries)
        .innerJoin(boxes, eq(boxes.id, deliveries.mailboxId))
        .where(and(eq(deliveries.id, id), eq(boxes.orgId, actor.orgId)));
    if (!row) throw new InboxError("발송 기록을 찾을 수 없습니다.", 404);
    return ownedMailbox(actor, row.mailboxId, exec);
}
export async function changeEmailDelivery(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
    now = new Date(),
) {
    const input = deliveryActionInput.parse(raw),
        hint = await emailDeliveryMailbox(actor, id, exec);
    return exec.transaction(async (tx) => {
        const box = await ownedMailbox(actor, hint.id, tx, true);
        const [item] = await tx
            .select()
            .from(deliveries)
            .where(and(eq(deliveries.id, id), eq(deliveries.mailboxId, box.id)))
            .for("update");
        if (!item) throw new InboxError("발송 기록을 찾을 수 없습니다.", 404);
        if (input.action === "retry" || input.action === "cancel") {
            const allowed =
                input.action === "retry"
                    ? ["failed"]
                    : ["queued", "leased", "failed", "uncertain"];
            if (!allowed.includes(item.state))
                throw new InboxError(
                    "현재 상태에서는 이 작업을 할 수 없습니다.",
                    409,
                );
            if (
                input.action === "retry" &&
                (!box.enabled || item.mailboxVersion !== box.version)
            )
                throw new InboxError(
                    "변경된 메일함의 이전 답장은 다시 보낼 수 없습니다.",
                    409,
                );
            const [next] = await tx
                .update(deliveries)
                .set({
                    state: input.action === "retry" ? "queued" : "cancelled",
                    errorCode: null,
                    leaseToken: null,
                    leaseUntil: null,
                })
                .where(eq(deliveries.id, id))
                .returning();
            await appendInboxAudit(tx, {
                orgId: actor.orgId,
                channelId: box.channelId,
                actorId: actor.userId,
                actorName: actor.name,
                action: `email.delivery.${input.action}`,
                changes: {
                    delivery: {
                        before: { id, state: item.state },
                        after: { id, state: next.state },
                    },
                },
            });
            return next;
        }
        if (item.leaseToken !== input.leaseToken)
            throw new InboxError("다른 작업자가 처리 중입니다.", 409);
        if (input.action === "begin") {
            if (
                item.state !== "leased" ||
                !item.leaseUntil ||
                item.leaseUntil <= now ||
                !box.enabled ||
                item.mailboxVersion !== box.version
            )
                throw new InboxError(
                    "발송 권한이 만료되거나 메일함 설정이 변경됐습니다.",
                    409,
                );
            const [next] = await tx
                .update(deliveries)
                .set({
                    state: "sending",
                    attempts: item.attempts + 1,
                    leaseUntil: new Date(now.getTime() + 120000),
                })
                .where(eq(deliveries.id, id))
                .returning();
            return next;
        }
        if (
            item.state === "sent" &&
            input.action === "sent" &&
            item.providerMessageId === input.providerMessageId
        )
            return item;
        const outcome =
            input.action === "prepare_failed" ? "failed" : input.action;
        if (
            (input.action === "failed" ||
                input.action === "uncertain" ||
                input.action === "prepare_failed") &&
            item.state === outcome &&
            item.errorCode === input.errorCode
        )
            return item;
        if (
            input.action === "prepare_failed"
                ? item.state !== "leased" ||
                  !item.leaseUntil ||
                  item.leaseUntil <= now ||
                  !box.enabled ||
                  item.mailboxVersion !== box.version
                : !["sending", "uncertain"].includes(item.state)
        )
            throw new InboxError("발송 결과를 기록할 수 없는 상태입니다.", 409);
        const [next] = await tx
            .update(deliveries)
            .set({
                state: outcome,
                ...(input.action === "sent"
                    ? {
                          providerMessageId: input.providerMessageId,
                          sentAt: now,
                          errorCode: null,
                      }
                    : { errorCode: input.errorCode }),
                leaseUntil: null,
            })
            .where(eq(deliveries.id, id))
            .returning();
        const [chat] = await tx
            .select({
                id: inboxConversations.id,
                contactId: inboxConversations.contactId,
            })
            .from(inboxMessages)
            .innerJoin(
                inboxConversations,
                eq(inboxConversations.id, inboxMessages.conversationId),
            )
            .where(eq(inboxMessages.id, item.messageId));
        const key = `email-delivery:${id}:${item.attempts}:${input.action}`;
        const summary =
            input.action === "sent"
                ? "메일 서비스가 답장을 접수했습니다."
                : outcome === "failed"
                  ? "메일 발송이 실패했습니다."
                  : "메일 발송 결과 확인이 필요합니다.";
        if (chat?.contactId)
            await appendActivity(tx, {
                orgId: actor.orgId,
                workspaceId: box.workspaceId,
                contactId: chat.contactId,
                source: "conversation",
                entityId: chat.id,
                eventKey: key,
                action: `email.${outcome}`,
                summary,
                actorName: actor.name,
                metadata: {
                    conversationId: chat.id,
                    messageId: item.messageId,
                    deliveryId: id,
                    state: outcome,
                },
                occurredAt: now,
            });
        if (chat)
            await enqueuePlatformEvent(tx, {
                orgId: actor.orgId,
                workspaceId: box.workspaceId,
                key,
                type: "conversation.updated",
                data: {
                    conversationId: chat.id,
                    contactId: chat.contactId,
                    action: `email.${outcome}`,
                    deliveryId: id,
                    messageId: item.messageId,
                    state: outcome,
                },
                occurredAt: now,
            });
        return next;
    });
}
