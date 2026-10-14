import {
    queueEmailReply,
    emailMessageDetails,
} from "@/lib/inbox-email/outgoing";
import { onSupportMessage, consumeSupportDraft } from "@/lib/customer-ai/queue";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, ilike, isNull, lt, or, sql } from "drizzle-orm";
import {
    db,
    inboxChannels,
    inboxConversations,
    inboxMessages,
    inboxReads,
    organizationMembers,
    users,
    workspaces,
    records,
    partitions,
    crmContacts,
    inboxAttachments,
    inboxMailboxes,
    inboxEmailThreads,
    customerAiJobs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import {
    channelInput,
    messageInput,
    patchInput,
    replyInput,
    safePageUrl,
    sessionInput,
    conversationFiltersInput,
    type ConversationFilters,
} from "./rules";

import { InboxError } from "./errors";
export { InboxError } from "./errors";
import { verifyCustomerIdentity } from "@/lib/customer-platform/identity";
import { appendActivity } from "@/lib/customer-platform/activities";
import {
    bindAttachments,
    fileOwner,
    messageAttachments,
    type FileScope,
} from "./files";
import { appendInboxAudit, type AuditChanges } from "./audit";
type Actor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
const conversationColumns = {
    medium: inboxConversations.medium,
    historyOnly: inboxConversations.historyOnly,
    importMetadata: inboxConversations.importMetadata,
    version: inboxConversations.version,
    aiState: inboxConversations.aiState,
    aiHandoffReason: inboxConversations.aiHandoffReason,
    id: inboxConversations.id,
    channelId: inboxConversations.channelId,
    name: inboxConversations.name,
    email: inboxConversations.email,
    pageUrl: inboxConversations.pageUrl,
    status: inboxConversations.status,
    assigneeId: inboxConversations.assigneeId,
    recordId: inboxConversations.recordId,
    tags: inboxConversations.tags,
    priority: inboxConversations.priority,
    preview: inboxConversations.preview,
    lastMessageAt: inboxConversations.lastMessageAt,
    customerSeq: inboxConversations.customerSeq,
    contactId: inboxConversations.contactId,
};
export async function bootstrapInbox(actor: Actor, exec: DbExec = db) {
    const [channels, members, spaces] = await Promise.all([
        exec
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.orgId, actor.orgId))
            .orderBy(inboxChannels.id),
        exec
            .select({ id: users.id, name: users.name })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
                and(
                    eq(organizationMembers.organizationId, actor.orgId),
                    eq(users.isActive, 1),
                ),
            ),
        exec
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.orgId, actor.orgId)),
    ]);
    return { channels, members, workspaces: spaces };
}
export async function saveChannel(
    actor: Actor,
    raw: unknown,
    exec: DbExec = db,
) {
    if (actor.role === "member")
        throw new InboxError("관리자만 상담창을 설정할 수 있습니다.", 403);
    const input = channelInput.parse(raw);
    const [space] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
            and(
                eq(workspaces.id, input.workspaceId),
                eq(workspaces.orgId, actor.orgId),
            ),
        );
    if (!space) throw new InboxError("워크스페이스를 찾을 수 없습니다.", 404);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, input.workspaceId))
            .for("update");
        const [before] = await tx
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.workspaceId, input.workspaceId));
        const [channel] = await tx
            .insert(inboxChannels)
            .values({
                ...input,
                orgId: actor.orgId,
                publicKey: randomBytes(24).toString("hex"),
            })
            .onConflictDoUpdate({
                target: inboxChannels.workspaceId,
                set: input,
            })
            .returning();
        const changes: AuditChanges = {};
        for (const key of [
            "name",
            "greeting",
            "color",
            "allowedOrigins",
            "enabled",
        ] as const)
            if (
                JSON.stringify(before?.[key] ?? null) !==
                JSON.stringify(input[key])
            )
                changes[key] = {
                    before: before?.[key] ?? null,
                    after: input[key],
                };
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: channel.id,
            actorId: actor.userId,
            actorName: actor.name,
            action: before ? "channel.updated" : "channel.created",
            changes,
        });
        return channel;
    });
}
export async function listConversations(
    actor: Actor,
    channelId: number,
    exec: DbExec = db,
    before?: Date,
    beforeId?: string,
    filters: Partial<ConversationFilters> = {},
) {
    const input = conversationFiltersInput.parse(filters);
    return exec
        .select({
            ...conversationColumns,
            unread: sql<boolean>`NOT ${inboxConversations.historyOnly} AND ${inboxConversations.customerSeq} > coalesce(${inboxReads.customerSeq},0)`,
        })
        .from(inboxConversations)
        .leftJoin(
            inboxReads,
            and(
                eq(inboxReads.conversationId, inboxConversations.id),
                eq(inboxReads.userId, actor.userId),
            ),
        )
        .where(
            and(
                eq(inboxConversations.orgId, actor.orgId),
                eq(inboxConversations.channelId, channelId),
                isNull(inboxConversations.mergedIntoId),
                eq(inboxConversations.historyOnly, input.filter === "history"),
                conversationSearch(input.q),
                input.status && input.filter !== "history"
                    ? eq(inboxConversations.status, input.status)
                    : undefined,
                input.filter === "mine"
                    ? eq(inboxConversations.assigneeId, actor.userId)
                    : undefined,
                input.filter === "unassigned"
                    ? isNull(inboxConversations.assigneeId)
                    : undefined,
                input.filter === "priority"
                    ? eq(inboxConversations.priority, true)
                    : undefined,
                input.filter === "unread"
                    ? sql`${inboxConversations.customerSeq} > coalesce(${inboxReads.customerSeq},0)`
                    : undefined,
                before
                    ? or(
                          lt(inboxConversations.lastMessageAt, before),
                          beforeId
                              ? and(
                                    eq(
                                        inboxConversations.lastMessageAt,
                                        before,
                                    ),
                                    lt(inboxConversations.id, beforeId),
                                )
                              : undefined,
                      )
                    : undefined,
            ),
        )
        .orderBy(
            desc(inboxConversations.lastMessageAt),
            desc(inboxConversations.id),
        )
        .limit(100);
}
function conversationSearch(q: string) {
    if (!q) return undefined;
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return or(
        ilike(inboxConversations.name, pattern),
        ilike(inboxConversations.email, pattern),
        ilike(inboxConversations.preview, pattern),
        sql`${inboxConversations.tags}::text ILIKE ${pattern}`,
        sql`EXISTS (SELECT 1 FROM ${inboxMessages} WHERE ${inboxMessages.conversationId} = ${inboxConversations.id} AND ${inboxMessages.body} ILIKE ${pattern})`,
    );
}
export async function conversationListPage(
    actor: Actor,
    channelId: number,
    filters: Partial<ConversationFilters>,
    before?: Date,
    beforeId?: string,
    exec: DbExec = db,
) {
    const input = conversationFiltersInput.parse(filters);
    const [rows, counts] = await Promise.all([
        listConversations(actor, channelId, exec, before, beforeId, input),
        exec
            .select({
                all: sql<number>`count(*) FILTER (WHERE NOT ${inboxConversations.historyOnly})`.mapWith(
                    Number,
                ),
                history:
                    sql<number>`count(*) FILTER (WHERE ${inboxConversations.historyOnly})`.mapWith(
                        Number,
                    ),
                mine: sql<number>`count(*) FILTER (WHERE NOT ${inboxConversations.historyOnly} AND ${inboxConversations.assigneeId} = ${actor.userId})`.mapWith(
                    Number,
                ),
                unassigned:
                    sql<number>`count(*) FILTER (WHERE NOT ${inboxConversations.historyOnly} AND ${inboxConversations.assigneeId} IS NULL)`.mapWith(
                        Number,
                    ),
                unread: sql<number>`count(*) FILTER (WHERE NOT ${inboxConversations.historyOnly} AND ${inboxConversations.customerSeq} > coalesce(${inboxReads.customerSeq},0))`.mapWith(
                    Number,
                ),
                priority:
                    sql<number>`count(*) FILTER (WHERE NOT ${inboxConversations.historyOnly} AND ${inboxConversations.priority})`.mapWith(
                        Number,
                    ),
            })
            .from(inboxConversations)
            .leftJoin(
                inboxReads,
                and(
                    eq(inboxReads.conversationId, inboxConversations.id),
                    eq(inboxReads.userId, actor.userId),
                ),
            )
            .where(
                and(
                    eq(inboxConversations.orgId, actor.orgId),
                    eq(inboxConversations.channelId, channelId),
                    isNull(inboxConversations.mergedIntoId),
                    conversationSearch(input.q),
                    input.status && input.filter !== "history"
                        ? or(
                              eq(inboxConversations.historyOnly, true),
                              eq(inboxConversations.status, input.status),
                          )
                        : undefined,
                ),
            ),
    ]);
    return { rows, counts: counts[0], hasMore: rows.length === 100 };
}
export async function ownedConversation(
    actor: Actor,
    id: string,
    exec: DbExec = db,
) {
    const [chat] = await exec
        .select(conversationColumns)
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.id, id),
                eq(inboxConversations.orgId, actor.orgId),
                isNull(inboxConversations.mergedIntoId),
            ),
        );
    if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    return chat;
}
async function readMessages(
    id: string,
    exec: DbExec,
    publicOnly: boolean,
    before?: number,
    historical = false,
) {
    const [cursor] =
        historical && before
            ? await exec
                  .select()
                  .from(inboxMessages)
                  .where(
                      and(
                          eq(inboxMessages.conversationId, id),
                          eq(inboxMessages.id, before),
                      ),
                  )
            : [];
    if (historical && before && !cursor)
        throw new InboxError("과거 대화 위치를 확인해주세요.", 404);
    const messages = await exec
        .select()
        .from(inboxMessages)
        .where(
            and(
                eq(inboxMessages.conversationId, id),
                publicOnly ? sql`${inboxMessages.kind} <> 'note'` : undefined,
                before
                    ? historical && cursor
                        ? or(
                              lt(inboxMessages.createdAt, cursor.createdAt),
                              and(
                                  eq(inboxMessages.createdAt, cursor.createdAt),
                                  lt(inboxMessages.id, before),
                              ),
                          )
                        : lt(inboxMessages.id, before)
                    : undefined,
            ),
        )
        .orderBy(
            ...(historical
                ? [desc(inboxMessages.createdAt), desc(inboxMessages.id)]
                : [desc(inboxMessages.id)]),
        )
        .limit(100);
    const attachments = await messageAttachments(
        exec,
        messages.map((m) => m.id),
    );
    const emailDetails = publicOnly
        ? { incoming: [], outgoing: [] }
        : await emailMessageDetails(
              exec,
              messages.map((m) => m.id),
          );
    return {
        messages: messages.reverse().map((m) => ({
            ...(!publicOnly
                ? {
                      email: emailDetails.incoming.find(
                          (e) => e.messageId === m.id,
                      )?.envelope,
                      delivery: emailDetails.outgoing.find(
                          (e) => e.messageId === m.id,
                      ),
                  }
                : {}),
            ...m,
            attachments: attachments
                .filter((f) => f.messageId === m.id)
                .map(({ messageId: _, ...f }) => {
                    void _;
                    return f;
                }),
        })),
        hasOlder: messages.length === 100,
    };
}
export async function conversationDetail(
    actor: Actor,
    id: string,
    exec: DbExec = db,
    before?: number,
) {
    const [alias] = await exec
        .select({ mergedIntoId: inboxConversations.mergedIntoId })
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.id, id),
                eq(inboxConversations.orgId, actor.orgId),
            ),
        );
    const conversation = await ownedConversation(
        actor,
        alias?.mergedIntoId ?? id,
        exec,
    );
    const [emailContext] =
        conversation.medium === "email"
            ? await exec
                  .select({
                      subject: inboxEmailThreads.subject,
                      recipient: inboxEmailThreads.correspondent,
                      from: inboxMailboxes.address,
                      enabled: inboxMailboxes.enabled,
                  })
                  .from(inboxEmailThreads)
                  .innerJoin(
                      inboxMailboxes,
                      eq(inboxMailboxes.id, inboxEmailThreads.mailboxId),
                  )
                  .where(eq(inboxEmailThreads.conversationId, conversation.id))
            : [];
    return {
        conversation: {
            ...conversation,
            ...(emailContext ? { emailContext } : {}),
        },
        ...(await readMessages(
            conversation.id,
            exec,
            false,
            before,
            conversation.historyOnly,
        )),
    };
}
export async function patchConversation(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const { version, ...input } = patchInput.parse(raw);
    if (!Object.keys(input).length)
        throw new InboxError("변경할 내용을 선택해주세요.");
    return exec.transaction(async (tx) => {
        const [chat] = await tx
            .select(conversationColumns)
            .from(inboxConversations)
            .where(
                and(
                    eq(inboxConversations.id, id),
                    eq(inboxConversations.orgId, actor.orgId),
                    isNull(inboxConversations.mergedIntoId),
                ),
            )
            .for("update");
        if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
        if (chat.historyOnly)
            throw new InboxError(
                "이전 서비스의 과거 기록입니다. 현재 상담에서 응대해주세요.",
                409,
            );
        if (version !== undefined && version !== chat.version)
            throw new InboxError(
                "다른 사람이 상담 정보를 변경했습니다. 최신 정보를 확인한 뒤 다시 저장해주세요.",
                409,
            );
        if (input.assigneeId) {
            const [member] = await tx
                .select({ id: users.id })
                .from(organizationMembers)
                .innerJoin(users, eq(users.id, organizationMembers.userId))
                .where(
                    and(
                        eq(organizationMembers.organizationId, actor.orgId),
                        eq(users.id, input.assigneeId),
                        eq(users.isActive, 1),
                    ),
                );
            if (!member)
                throw new InboxError("이 조직의 활성 팀원을 선택해주세요.");
        }
        if (input.recordId) {
            const [record] = await tx
                .select({ id: records.id })
                .from(records)
                .innerJoin(partitions, eq(partitions.id, records.partitionId))
                .innerJoin(
                    workspaces,
                    eq(workspaces.id, partitions.workspaceId),
                )
                .innerJoin(inboxConversations, eq(inboxConversations.id, id))
                .innerJoin(
                    inboxChannels,
                    eq(inboxChannels.id, inboxConversations.channelId),
                )
                .where(
                    and(
                        eq(records.id, input.recordId),
                        eq(records.orgId, actor.orgId),
                        eq(workspaces.id, inboxChannels.workspaceId),
                    ),
                );
            if (!record)
                throw new InboxError(
                    "이 상담 채널과 같은 워크스페이스의 CRM 고객을 선택해주세요.",
                );
        }

        const normalized = {
            ...input,
            ...(input.aiState
                ? {
                      aiHandoffReason:
                          input.aiState === "auto"
                              ? null
                              : "상담원이 직접 응대를 선택했습니다.",
                  }
                : {}),
            ...(input.tags ? { tags: [...new Set(input.tags)] } : {}),
        };
        const changes: AuditChanges = {};
        for (const key of Object.keys(
            normalized,
        ) as (keyof typeof normalized)[]) {
            if (JSON.stringify(chat[key]) !== JSON.stringify(normalized[key]))
                changes[key] = { before: chat[key], after: normalized[key] };
        }
        if (!Object.keys(changes).length) return chat;
        if (changes.assigneeId) {
            const ids = [chat.assigneeId, input.assigneeId].filter(
                (v): v is string => !!v,
            );
            const people = ids.length
                ? await tx
                      .select({ id: users.id, name: users.name })
                      .from(users)
                      .where(
                          sql`${users.id} in (${sql.join(
                              ids.map((v) => sql`${v}`),
                              sql`,`,
                          )})`,
                      )
                : [];
            changes.assigneeId.beforeLabel =
                people.find((p) => p.id === chat.assigneeId)?.name ??
                "담당자 없음";
            changes.assigneeId.afterLabel =
                people.find((p) => p.id === input.assigneeId)?.name ??
                "담당자 없음";
        }
        const [updated] = await tx
            .update(inboxConversations)
            .set({ ...normalized, version: chat.version + 1 })
            .where(eq(inboxConversations.id, id))
            .returning(conversationColumns);
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: chat.channelId,
            conversationId: id,
            actorId: actor.userId,
            actorName: actor.name,
            action: "conversation.updated",
            changes,
        });
        return updated;
    });
}

export async function markRead(
    actor: Actor,
    id: string,
    seenSeq: number,
    exec: DbExec = db,
) {
    const chat = await ownedConversation(actor, id, exec);
    const seen = Math.min(chat.customerSeq, Math.max(0, seenSeq));
    await exec
        .insert(inboxReads)
        .values({ conversationId: id, userId: actor.userId, customerSeq: seen })
        .onConflictDoUpdate({
            target: [inboxReads.conversationId, inboxReads.userId],
            set: {
                customerSeq: sql`greatest(${inboxReads.customerSeq},${seen})`,
            },
        });
}
export async function appendMessage(
    exec: DbExec,
    id: string,
    message: {
        clientId: string;
        kind: "reply" | "note" | "customer";
        body: string;
        authorId?: string;
        authorName: string;
        attachmentIds: string[];
        aiDraftId?: string;
        createdAt?: Date;
        sourceAttachmentCount?: number;
    },
    scope: FileScope,
) {
    return exec.transaction(async (tx) => {
        // Match email intake/settings lock order: mailbox before conversation.
        // Hold through enqueue so a concurrent disable cancels the committed queue entry.
        const [emailHint] = await tx
            .select({ mailboxId: inboxEmailThreads.mailboxId })
            .from(inboxEmailThreads)
            .where(eq(inboxEmailThreads.conversationId, id));
        if (emailHint)
            await tx
                .select({ id: inboxMailboxes.id })
                .from(inboxMailboxes)
                .where(
                    and(
                        eq(inboxMailboxes.id, emailHint.mailboxId),
                        eq(inboxMailboxes.orgId, scope.orgId),
                    ),
                )
                .for("share");
        const [locked] = await tx
            .select()
            .from(inboxConversations)
            .where(eq(inboxConversations.id, id))
            .for("update");
        if (
            !locked ||
            locked.orgId !== scope.orgId ||
            locked.channelId !== scope.channelId ||
            locked.mergedIntoId ||
            locked.historyOnly ||
            (scope.publicOnly &&
                (locked.contactId
                    ? scope.ownerKey !==
                      fileOwner(
                          `member:${locked.channelId}:${locked.contactId}`,
                      )
                    : !!locked.identifiedAt))
        )
            throw new InboxError(
                "회원 상담으로 연결된 이력입니다. 상담 목록을 새로 불러와주세요.",
                409,
            );
        const [duplicate] = await tx
            .select()
            .from(inboxMessages)
            .where(
                and(
                    eq(inboxMessages.conversationId, id),
                    eq(inboxMessages.clientId, message.clientId),
                ),
            );
        if (duplicate) {
            const attached = await messageAttachments(tx, [duplicate.id]);
            if (
                duplicate.aiDraftId !== (message.aiDraftId ?? null) ||
                duplicate.kind !== message.kind ||
                duplicate.body !== message.body ||
                JSON.stringify(attached.map((f) => f.id).sort()) !==
                    JSON.stringify([...message.attachmentIds].sort())
            )
                throw new InboxError("이미 처리된 메시지 번호입니다.", 409);
            return {
                ...duplicate,
                attachments: attached.map(({ messageId: _, ...f }) => {
                    void _;
                    return f;
                }),
            };
        }
        if (message.kind === "reply" && locked.status === "closed")
            throw new InboxError("상담을 다시 연 뒤 답변해주세요.");
        if (message.kind === "customer" && locked.medium === "web") {
            const recent = await tx
                .select({ id: inboxMessages.id })
                .from(inboxMessages)
                .where(
                    and(
                        eq(inboxMessages.conversationId, id),
                        eq(inboxMessages.kind, "customer"),
                        gt(
                            inboxMessages.createdAt,
                            new Date(Date.now() - 60000),
                        ),
                    ),
                )
                .limit(20);
            if (recent.length >= 20)
                throw new InboxError(
                    "메시지가 많습니다. 잠시 후 다시 보내주세요.",
                    429,
                );
        }
        if (
            locked.medium === "email" &&
            message.kind === "reply" &&
            !message.authorId
        )
            throw new InboxError(
                "이메일은 상담원이 검토한 답장만 발송합니다.",
                409,
            );
        if (message.aiDraftId)
            await consumeSupportDraft(
                tx,
                message.aiDraftId,
                id,
                message.body,
                message.authorId,
            );
        if (locked.medium === "email" && scope.publicOnly)
            throw new InboxError(
                "이메일 상담은 사이트 상담창에서 조회할 수 없습니다.",
                403,
            );
        const { attachmentIds, sourceAttachmentCount, ...value } = message;
        if (
            sourceAttachmentCount !== undefined &&
            (locked.medium !== "email" ||
                message.kind !== "customer" ||
                !Number.isInteger(sourceAttachmentCount) ||
                sourceAttachmentCount < 0 ||
                sourceAttachmentCount > 50)
        )
            throw new InboxError("메일 원본 첨부 정보를 확인해주세요.");
        const [inserted] = await tx
            .insert(inboxMessages)
            .values({ ...value, conversationId: id })
            .returning();
        if (message.aiDraftId)
            await tx
                .update(customerAiJobs)
                .set({ sentMessageId: inserted.id })
                .where(eq(customerAiJobs.id, message.aiDraftId));
        const attachments = await bindAttachments(
            tx,
            scope,
            message.kind,
            attachmentIds,
            inserted.id,
        );
        if (locked.medium === "email" && message.kind === "reply")
            await queueEmailReply(tx, id, inserted.id, attachments.length);
        const summary =
            message.body ||
            `파일 ${attachments.length}개 · ${attachments[0]?.fileName ?? ""}`;
        if (message.kind !== "note") {
            const [eventChannel] = await tx
                .select({ workspaceId: inboxChannels.workspaceId })
                .from(inboxChannels)
                .where(eq(inboxChannels.id, locked.channelId));
            await enqueuePlatformEvent(tx, {
                orgId: locked.orgId,
                workspaceId: eventChannel.workspaceId,
                key: `message:${inserted.id}`,
                type: "message.created",
                data: {
                    conversationId: id,
                    contactId: locked.contactId,
                    message: {
                        id: inserted.id,
                        clientId: inserted.clientId,
                        kind: inserted.kind,
                        body: inserted.body,
                        authorName: inserted.authorName,
                        createdAt: inserted.createdAt,
                        attachments,
                        ...(sourceAttachmentCount !== undefined
                            ? { sourceAttachmentCount }
                            : {}),
                    },
                },
                occurredAt: inserted.createdAt,
            });
            if (locked.contactId) {
                const [channel] = await tx
                    .select({ workspaceId: inboxChannels.workspaceId })
                    .from(inboxChannels)
                    .where(eq(inboxChannels.id, locked.channelId));
                await appendActivity(tx, {
                    orgId: locked.orgId,
                    workspaceId: channel.workspaceId,
                    contactId: locked.contactId,
                    source: "conversation",
                    entityId: id,
                    eventKey: `message:${inserted.id}`,
                    action: message.kind,
                    summary:
                        locked.medium === "email" && message.kind === "reply"
                            ? `메일 답장 발송 대기 · ${summary}`
                            : summary,
                    actorName: message.authorName,
                    metadata: {
                        conversationId: id,
                        messageId: inserted.id,
                        attachmentCount:
                            sourceAttachmentCount ?? attachments.length,
                    },
                    occurredAt: inserted.createdAt,
                });
            }
            const reopen =
                message.kind === "customer" && locked.status !== "open";
            if (reopen)
                await appendInboxAudit(tx, {
                    orgId: locked.orgId,
                    channelId: locked.channelId,
                    conversationId: id,
                    actorName: message.authorName,
                    action: "customer.reopened",
                    changes: {
                        status: { before: locked.status, after: "open" },
                    },
                });
            await tx
                .update(inboxConversations)
                .set({
                    preview: summary.slice(0, 200),
                    lastMessageAt: sql`greatest(${inboxConversations.lastMessageAt},${inserted.createdAt})`,
                    ...(message.kind === "customer"
                        ? {
                              status: "open",
                              customerSeq: sql`${inboxConversations.customerSeq} + 1`,
                          }
                        : {}),
                    ...(reopen ? { version: locked.version + 1 } : {}),
                })
                .where(eq(inboxConversations.id, id));
        }
        if (locked.medium === "web")
            await onSupportMessage(tx, id, inserted, attachments.length);
        return { ...inserted, attachments };
    });
}

export async function sendSystemReply(
    exec: DbExec,
    id: string,
    body: string,
    clientId: string,
    aiDraftId?: string,
    authorName = "AI 상담 도우미",
) {
    const [chat] = await exec
        .select({
            orgId: inboxConversations.orgId,
            channelId: inboxConversations.channelId,
        })
        .from(inboxConversations)
        .where(eq(inboxConversations.id, id));
    return appendMessage(
        exec,
        id,
        {
            clientId,
            kind: "reply",
            body,
            authorName,
            attachmentIds: [],
            aiDraftId,
        },
        {
            orgId: chat.orgId,
            channelId: chat.channelId,
            conversationId: id,
            ownerKey: fileOwner(`system:${id}`),
            publicOnly: false,
        },
    );
}
export async function sendAgentMessage(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = replyInput.parse(raw);
    const scope = await staffFileScope(actor, id, exec);
    return appendMessage(
        exec,
        id,
        {
            ...input,
            authorId: actor.userId,
            authorName: actor.name,
        },
        scope,
    );
}
export async function staffFileScope(
    actor: Actor,
    id: string,
    exec: DbExec = db,
): Promise<FileScope> {
    const chat = await ownedConversation(actor, id, exec);
    return {
        orgId: actor.orgId,
        channelId: chat.channelId,
        conversationId: id,
        ownerKey: fileOwner(`staff:${actor.userId}:${chat.channelId}`),
        publicOnly: false,
    };
}
export async function staffDownloadScope(
    actor: Actor,
    id: string,
    exec: DbExec = db,
): Promise<FileScope> {
    const [row] = await exec
        .select({
            channelId: inboxAttachments.channelId,
            conversationId: inboxMessages.conversationId,
            draftId: inboxAttachments.draftConversationId,
        })
        .from(inboxAttachments)
        .leftJoin(
            inboxMessages,
            eq(inboxMessages.id, inboxAttachments.messageId),
        )
        .where(
            and(
                eq(inboxAttachments.id, id),
                eq(inboxAttachments.orgId, actor.orgId),
            ),
        );
    if (!row) throw new InboxError("첨부 파일을 찾을 수 없습니다.", 404);
    return {
        orgId: actor.orgId,
        channelId: row.channelId,
        conversationId: row.conversationId ?? row.draftId,
        ownerKey: fileOwner(`staff:${actor.userId}:${row.channelId}`),
        publicOnly: false,
    };
}
export async function publicChannel(key: string, exec: DbExec = db) {
    const [channel] = await exec
        .select()
        .from(inboxChannels)
        .where(
            and(
                eq(inboxChannels.publicKey, key),
                eq(inboxChannels.enabled, true),
            ),
        );
    if (!channel)
        throw new InboxError("지금은 상담창을 이용할 수 없습니다.", 404);
    return channel;
}
export async function startVisitorSession(
    key: string,
    raw: unknown,
    exec: DbExec = db,
) {
    return exec.transaction((tx) => startVisitorSessionInTx(key, raw, tx));
}
async function startVisitorSessionInTx(
    key: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = sessionInput.parse(raw),
        channel = await publicChannel(key, exec);
    if (input.identityToken) {
        const chat = await visitorConversation(
            key,
            input.identityToken,
            exec,
            true,
        );
        return { token: input.identityToken, id: chat.id };
    }
    const token = input.token ?? randomBytes(32).toString("hex");
    if (input.token) {
        const [chat] = await exec
            .select({ id: inboxConversations.id })
            .from(inboxConversations)
            .where(
                and(
                    eq(inboxConversations.channelId, channel.id),
                    eq(inboxConversations.tokenHash, hash(token)),
                    isNull(inboxConversations.contactId),
                    isNull(inboxConversations.mergedIntoId),
                    isNull(inboxConversations.identifiedAt),
                    eq(inboxConversations.historyOnly, false),
                    eq(inboxConversations.medium, "web"),
                ),
            );
        if (!chat)
            throw new InboxError(
                "상담 세션이 만료되었습니다. 새 문의를 시작해주세요.",
                401,
            );
        return { token, id: chat.id };
    }
    if (!input.name) throw new InboxError("이름 또는 닉네임을 입력해주세요.");
    const [chat] = await exec
        .insert(inboxConversations)
        .values({
            channelId: channel.id,
            orgId: channel.orgId,
            tokenHash: hash(token),
            name: input.name,
            email: input.email || null,
            pageUrl: safePageUrl(input.pageUrl, channel.allowedOrigins),
        })
        .returning({ id: inboxConversations.id });
    await enqueuePlatformEvent(exec, {
        orgId: channel.orgId,
        workspaceId: channel.workspaceId,
        key: `conversation:${chat.id}:created`,
        type: "conversation.created",
        data: {
            conversationId: chat.id,
            channelId: channel.id,
            contactId: null,
            name: input.name,
            email: input.email || null,
        },
    });
    return { token, id: chat.id };
}
export async function authenticatedCustomer(
    key: string,
    token: string,
    exec: DbExec = db,
) {
    const channel = await publicChannel(key, exec),
        contactId = verifyCustomerIdentity(token, key);
    const [contact] = await exec
        .select()
        .from(crmContacts)
        .where(
            and(
                eq(crmContacts.id, contactId),
                eq(crmContacts.orgId, channel.orgId),
                eq(crmContacts.workspaceId, channel.workspaceId),
            ),
        );
    if (!contact)
        throw new InboxError("회원 상담 고객을 찾을 수 없습니다.", 401);
    return { channel, contact };
}
async function visitorConversation(
    key: string,
    token: string,
    exec: DbExec,
    create = false,
) {
    if (token.includes(".")) {
        const { channel, contact } = await authenticatedCustomer(
            key,
            token,
            exec,
        );
        // Serialize member creation with anonymous-to-member linking.
        if (create)
            await exec
                .select({ id: crmContacts.id })
                .from(crmContacts)
                .where(eq(crmContacts.id, contact.id))
                .for("update");
        let [chat] = await exec
            .select({
                id: inboxConversations.id,
                status: inboxConversations.status,
                aiState: inboxConversations.aiState,
            })
            .from(inboxConversations)
            .where(
                and(
                    eq(inboxConversations.channelId, channel.id),
                    eq(inboxConversations.contactId, contact.id),
                    eq(inboxConversations.historyOnly, false),
                    eq(inboxConversations.medium, "web"),
                ),
            );
        if (!chat && create) {
            const [created] = await exec
                .insert(inboxConversations)
                .values({
                    channelId: channel.id,
                    orgId: channel.orgId,
                    contactId: contact.id,
                    tokenHash: hash(randomBytes(32).toString("hex")),
                    name: contact.name,
                    email: contact.email,
                    recordId: contact.recordId,
                })
                .onConflictDoNothing({
                    target: [
                        inboxConversations.channelId,
                        inboxConversations.contactId,
                    ],
                    where: sql`${inboxConversations.historyOnly}=false AND ${inboxConversations.medium}='web'`,
                })
                .returning({ id: inboxConversations.id });
            if (created)
                await enqueuePlatformEvent(exec, {
                    orgId: channel.orgId,
                    workspaceId: channel.workspaceId,
                    key: `conversation:${created.id}:created`,
                    type: "conversation.created",
                    data: {
                        conversationId: created.id,
                        channelId: channel.id,
                        contactId: contact.id,
                        name: contact.name,
                        email: contact.email,
                    },
                });
            [chat] = await exec
                .select({
                    id: inboxConversations.id,
                    status: inboxConversations.status,
                    aiState: inboxConversations.aiState,
                })
                .from(inboxConversations)
                .where(
                    and(
                        eq(inboxConversations.channelId, channel.id),
                        eq(inboxConversations.contactId, contact.id),
                        eq(inboxConversations.historyOnly, false),
                        eq(inboxConversations.medium, "web"),
                    ),
                );
        }
        return {
            id: chat?.id ?? null,
            channelId: channel.id,
            orgId: channel.orgId,
            ownerKey: fileOwner(`member:${channel.id}:${contact.id}`),
            status: chat?.status ?? "open",
            aiState: chat?.aiState ?? "auto",
            name: contact.name,
            profile: {
                name: contact.name,
                email: contact.email,
                identified: true,
            },
        };
    }
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new InboxError("상담 세션을 확인해주세요.", 401);
    const channel = await publicChannel(key, exec);
    const [chat] = await exec
        .select({
            id: inboxConversations.id,
            name: inboxConversations.name,
            status: inboxConversations.status,
            aiState: inboxConversations.aiState,
        })
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.channelId, channel.id),
                eq(inboxConversations.tokenHash, hash(token)),
                isNull(inboxConversations.contactId),
                isNull(inboxConversations.mergedIntoId),
                isNull(inboxConversations.identifiedAt),
                eq(inboxConversations.historyOnly, false),
                eq(inboxConversations.medium, "web"),
            ),
        );
    if (!chat) throw new InboxError("상담 세션을 확인해주세요.", 401);
    return {
        ...chat,
        channelId: channel.id,
        orgId: channel.orgId,
        ownerKey: fileOwner(`visitor:${channel.id}:${token}`),
        profile: { name: chat.name, identified: false, email: null },
    };
}
export async function visitorFileScope(
    key: string,
    token: string,
    exec: DbExec = db,
): Promise<FileScope> {
    const chat = await visitorConversation(key, token, exec);
    return {
        orgId: chat.orgId,
        channelId: chat.channelId,
        conversationId: chat.id,
        ownerKey: chat.ownerKey,
        publicOnly: true,
    };
}
export async function visitorDetail(
    key: string,
    token: string,
    exec: DbExec = db,
    before?: number,
) {
    const chat = await visitorConversation(key, token, exec);
    const result = chat.id
        ? await readMessages(chat.id, exec, true, before)
        : { messages: [], hasOlder: false };
    // 방문자에게는 직원 식별자·내부 메모·CRM 연결 정보를 내보내지 않는다.
    return {
        status: chat.status,
        aiState: chat.aiState,
        profile: chat.profile,
        hasOlder: result.hasOlder,
        messages: result.messages.map((m) => ({
            id: m.id,
            clientId: m.clientId,
            kind: m.kind,
            body: m.body,
            authorName: m.authorName,
            createdAt: m.createdAt,
            attachments: m.attachments,
        })),
    };
}
export async function sendVisitorMessage(
    key: string,
    token: string,
    raw: unknown,
    exec: DbExec = db,
) {
    return exec.transaction((tx) =>
        sendVisitorMessageInTx(key, token, raw, tx),
    );
}
async function sendVisitorMessageInTx(
    key: string,
    token: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = messageInput.parse(raw),
        chat = await visitorConversation(key, token, exec, true);
    if (!chat.id) throw new InboxError("상담을 시작하지 못했습니다.", 503);
    const result = await appendMessage(
        exec,
        chat.id,
        {
            ...input,
            kind: "customer",
            authorName: chat.name,
        },
        {
            orgId: chat.orgId,
            channelId: chat.channelId,
            conversationId: chat.id,
            ownerKey: chat.ownerKey,
            publicOnly: true,
        },
    );
    return { id: result.id, clientId: result.clientId };
}
