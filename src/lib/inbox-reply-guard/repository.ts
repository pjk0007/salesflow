import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
    db,
    inboxChannels as channels,
    inboxConversations as chats,
    inboxReplyLeases as leases,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    requireCustomerChannel,
    requireCustomerAccess,
    customerAccessPredicate,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { appendInboxAudit } from "@/lib/inbox/audit";
import {
    replyGuardSettingsInput,
    replyLeaseInput,
    REPLY_LEASE_TTL_MS,
} from "./rules";
import type { z } from "zod";

async function activeLease(
    exec: DbExec,
    chat: typeof chats.$inferSelect,
    channel: typeof channels.$inferSelect,
    now: Date,
): Promise<{ lease: typeof leases.$inferSelect; name: string } | null> {
    const [lease] = await exec
        .select({ lease: leases, name: users.name })
        .from(leases)
        .innerJoin(users, eq(users.id, leases.userId))
        .where(
            and(
                eq(leases.conversationId, chat.id),
                eq(leases.guardVersion, channel.replyGuardVersion),
                sql`${leases.expiresAt}>${now.toISOString()}::timestamptz`,
                customerAccessPredicate(
                    chat.orgId,
                    leases.userId,
                    sql`${channel.workspaceId}`,
                    "respond",
                ),
            ),
        );
    return lease ?? null;
}
async function ownedChat(
    actor: CustomerActor,
    id: string,
    exec: DbExec,
    lock = false,
) {
    const query = exec
        .select()
        .from(chats)
        .where(
            and(
                eq(chats.id, id),
                eq(chats.orgId, actor.orgId),
                sql`${chats.mergedIntoId} IS NULL`,
            ),
        );
    const [chat] = await (lock ? query.for("update") : query);
    if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    return chat;
}
function leaseView(
    lease: Awaited<ReturnType<typeof activeLease>>,
    actor: CustomerActor,
    sessionId: string | undefined,
) {
    return lease
        ? {
              id: lease.lease.id,
              userId: lease.lease.userId,
              name: lease.name,
              isMine:
                  lease.lease.userId === actor.userId &&
                  lease.lease.sessionId === sessionId,
              baseRevision: lease.lease.baseRevision,
              expiresAt: lease.lease.expiresAt.toISOString(),
          }
        : null;
}
export async function replyGuardPage(
    actor: CustomerActor,
    channelId: number,
    conversationId?: string,
    sessionId?: string,
    exec: DbExec = db,
    now = new Date(),
) {
    const channel = await requireCustomerChannel(
            actor,
            channelId,
            "read",
            exec,
        ),
        access = await requireCustomerAccess(
            actor,
            channel.workspaceId,
            "read",
            exec,
        );
    const chat = conversationId
        ? await ownedChat(actor, conversationId, exec)
        : null;
    if (chat && chat.channelId !== channelId)
        throw new InboxError("이 사업의 상담을 선택해주세요.", 404);
    const lease =
        chat && channel.replyGuardEnabled
            ? await activeLease(exec, chat, channel, now)
            : null;
    return {
        enabled: channel.replyGuardEnabled,
        version: channel.replyGuardVersion,
        canManage: access.abilities.manage,
        conversation: chat
            ? {
                  revision: chat.replyRevision,
                  lease: leaseView(lease, actor, sessionId),
              }
            : null,
        serverTime: now.toISOString(),
    };
}
export async function setReplyGuard(
    actor: CustomerActor,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = replyGuardSettingsInput.parse(raw);
    await requireCustomerChannel(actor, input.channelId, "manage", exec);
    return exec.transaction(async (tx) => {
        const [channel] = await tx
            .select()
            .from(channels)
            .where(
                and(
                    eq(channels.id, input.channelId),
                    eq(channels.orgId, actor.orgId),
                ),
            )
            .for("update");
        if (channel.replyGuardVersion !== input.version)
            throw new InboxError(
                "다른 창에서 답변 잠금 설정을 변경했습니다. 작성한 설정을 보존하고 최신 설정을 불러와주세요.",
                409,
            );
        if (channel.replyGuardEnabled === input.enabled)
            return replyGuardPage(actor, channel.id, undefined, undefined, tx);
        await tx
            .update(channels)
            .set({
                replyGuardEnabled: input.enabled,
                replyGuardVersion: input.version + 1,
            })
            .where(eq(channels.id, channel.id));
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: channel.id,
            actorId: actor.userId,
            actorName: actor.name,
            action: "reply_guard.settings.updated",
            changes: {
                replyGuardEnabled: {
                    before: channel.replyGuardEnabled,
                    after: input.enabled,
                },
            },
        });
        return replyGuardPage(actor, channel.id, undefined, undefined, tx);
    });
}
export async function updateReplyLease(
    actor: CustomerActor,
    raw: unknown,
    exec: DbExec = db,
    now = new Date(),
) {
    const input = replyLeaseInput.parse(raw),
        hint = await ownedChat(actor, input.conversationId, exec);
    await requireCustomerChannel(actor, hint.channelId, "respond", exec);
    return exec.transaction(async (tx) => {
        const chat = await ownedChat(actor, input.conversationId, tx, true),
            [channel] = await tx
                .select()
                .from(channels)
                .where(eq(channels.id, chat.channelId));
        const [stored] = await tx
            .select()
            .from(leases)
            .where(eq(leases.conversationId, chat.id));
        const own =
            stored?.userId === actor.userId &&
            stored?.sessionId === input.sessionId;
        if (input.action === "release") {
            if (own && stored.id === input.leaseId)
                await tx
                    .update(leases)
                    .set({ expiresAt: now })
                    .where(eq(leases.conversationId, chat.id));
            return replyGuardPage(
                actor,
                chat.channelId,
                chat.id,
                input.sessionId,
                tx,
                now,
            );
        }
        if (!channel.replyGuardEnabled)
            throw new InboxError("이 사업의 답변 잠금이 꺼져 있습니다.", 409);
        if (chat.historyOnly || chat.status === "closed")
            throw new InboxError(
                "진행 중인 현재 상담에서 답변을 작성해주세요.",
                409,
            );
        const current = await activeLease(tx, chat, channel, now);
        if (input.action !== "acquire") {
            if (!current || !own || current.lease.id !== input.leaseId)
                throw new InboxError(
                    "답변 작성 권한이 만료되거나 인계되었습니다. 초안을 유지하고 다시 확인해주세요.",
                    409,
                );
            if (
                input.action === "acknowledge" &&
                input.revision !== chat.replyRevision
            )
                throw new InboxError(
                    "새 대화가 더 도착했습니다. 최신 메시지를 확인한 뒤 다시 진행해주세요.",
                    409,
                );
            await tx
                .update(leases)
                .set({
                    expiresAt: new Date(now.getTime() + REPLY_LEASE_TTL_MS),
                    ...(input.action === "acknowledge"
                        ? { baseRevision: chat.replyRevision }
                        : {}),
                })
                .where(eq(leases.conversationId, chat.id));
        } else {
            if (input.revision !== chat.replyRevision)
                throw new InboxError(
                    "대화가 변경되었습니다. 최신 메시지를 확인한 뒤 답변 작성을 시작해주세요.",
                    409,
                );
            if (input.takeover) {
                await requireCustomerChannel(
                    actor,
                    chat.channelId,
                    "manage",
                    tx,
                );
                if (current?.lease.id !== input.takeover.leaseId)
                    throw new InboxError(
                        "작성 중인 직원이 바뀌었습니다. 현재 상태를 확인하고 다시 인계해주세요.",
                        409,
                    );
            } else if (current && !own)
                throw new InboxError(
                    `${current.name}님이 답변을 작성 중입니다. 내부 메모로 협의하거나 작성 권한이 해제될 때까지 기다려주세요.`,
                    409,
                );
            if (current && own && !input.takeover)
                return replyGuardPage(
                    actor,
                    chat.channelId,
                    chat.id,
                    input.sessionId,
                    tx,
                    now,
                );
            const value = {
                id: randomUUID(),
                userId: actor.userId,
                sessionId: input.sessionId,
                guardVersion: channel.replyGuardVersion,
                baseRevision: chat.replyRevision,
                expiresAt: new Date(now.getTime() + REPLY_LEASE_TTL_MS),
            };
            await tx
                .insert(leases)
                .values({ conversationId: chat.id, ...value })
                .onConflictDoUpdate({
                    target: leases.conversationId,
                    set: value,
                });
            await appendInboxAudit(tx, {
                orgId: actor.orgId,
                channelId: chat.channelId,
                conversationId: chat.id,
                actorId: actor.userId,
                actorName: actor.name,
                action: input.takeover
                    ? "reply_guard.taken_over"
                    : "reply_guard.acquired",
                changes: {
                    replyWriter: {
                        before: current?.lease.userId ?? null,
                        after: actor.userId,
                        beforeLabel: current?.name ?? "작성자 없음",
                        afterLabel: actor.name,
                    },
                    ...(input.takeover
                        ? {
                              handoffReason: {
                                  before: null,
                                  after: input.takeover.reason,
                              },
                          }
                        : {}),
                },
            });
        }
        return replyGuardPage(
            actor,
            chat.channelId,
            chat.id,
            input.sessionId,
            tx,
            now,
        );
    });
}

export async function enforceReplyGuard(
    exec: DbExec,
    chat: typeof chats.$inferSelect,
    message: {
        authorId?: string;
        replyGuard?: z.infer<typeof import("./rules").replyGuardContext>;
    },
    now = new Date(),
) {
    const [channel] = await exec
        .select()
        .from(channels)
        .where(eq(channels.id, chat.channelId));
    if (!channel.replyGuardEnabled) return;
    const current = await activeLease(exec, chat, channel, now),
        context = message.replyGuard;
    if (!message.authorId) {
        if (current)
            throw new InboxError(
                "상담원이 답변을 작성 중이어서 자동 답변을 보류했습니다.",
                409,
            );
        return;
    }
    if (
        !context ||
        !current ||
        current.lease.id !== context.leaseId ||
        current.lease.userId !== message.authorId ||
        current.lease.sessionId !== context.sessionId
    )
        throw new InboxError(
            "답변 작성 권한을 먼저 확보해주세요. 작성한 초안은 유지됩니다.",
            409,
        );
    if (
        context.revision !== chat.replyRevision ||
        current.lease.baseRevision !== chat.replyRevision
    )
        throw new InboxError(
            "작성 중 새 대화가 도착했습니다. 최신 메시지를 확인하고 초안을 검토해주세요.",
            409,
        );
    await exec
        .update(leases)
        .set({ expiresAt: now })
        .where(eq(leases.conversationId, chat.id));
}

export async function activeReplyWriter(
    exec: DbExec,
    chat: typeof chats.$inferSelect,
    now = new Date(),
) {
    const [channel] = await exec
        .select()
        .from(channels)
        .where(eq(channels.id, chat.channelId));
    return (
        channel.replyGuardEnabled &&
        !!(await activeLease(exec, chat, channel, now))
    );
}
