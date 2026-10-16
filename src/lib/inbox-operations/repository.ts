import {
    activeCustomerActor,
    requireCustomerAccess,
    customerAccessPredicate,
} from "@/lib/customer-access/access";
import { and, eq, isNull, sql, desc, lt, or, inArray } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxChannels as channels,
    inboxConversations as chats,
    inboxReads as reads,
    crmContacts,
    inboxNotifications as notices,
    inboxOperationsSettings as settings,
    inboxServiceCases as cases,
    inboxResponseObligations as obligations,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { InboxError } from "@/lib/inbox/errors";
import { hasMinRole } from "@/lib/auth-admin-rules";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { defaultPolicy, policyInput, operationsWorkerEnabled } from "./rules";
import {
    businessAvailability,
    businessMilliseconds,
    addBusinessMilliseconds,
} from "./calendar";
export type OperationsActor = Pick<
    JWTPayload,
    "orgId" | "userId" | "name" | "role"
>;
export async function activeOperationsActor(
    actor: OperationsActor,
    exec: DbExec,
    minRole: "member" | "admin" = "member",
) {
    const current = await activeCustomerActor(actor, exec);
    if (!hasMinRole(current.role, minRole))
        throw new InboxError("현재 조직 권한을 확인해주세요.", 403);
}
export async function operationsChannel(
    actor: OperationsActor,
    id: number,
    exec: DbExec = db,
) {
    const [channel] = await exec
        .select()
        .from(channels)
        .where(and(eq(channels.id, id), eq(channels.orgId, actor.orgId)));
    if (!channel) throw new InboxError("상담 채널을 찾을 수 없습니다.", 404);
    await requireCustomerAccess(actor, channel.workspaceId, "read", exec);
    return channel;
}
export async function operationsSettings(
    actor: OperationsActor,
    id: number,
    exec: DbExec = db,
    now = new Date(),
) {
    await activeOperationsActor(actor, exec);
    await operationsChannel(actor, id, exec);
    const [saved] = await exec
        .select()
        .from(settings)
        .where(eq(settings.channelId, id));
    return {
        version: saved?.version ?? 0,
        policy: saved?.policy ?? defaultPolicy(),
        effectiveAt: saved?.effectiveAt ?? null,
        workerEnabled: operationsWorkerEnabled(),
        configured: !!saved,
        availability: saved
            ? businessAvailability(saved.policy.calendar, now)
            : null,
    };
}
export async function saveOperationsSettings(
    actor: OperationsActor,
    id: number,
    raw: unknown,
    exec: DbExec = db,
    now = new Date(),
) {
    const input = z
        .object({
            version: z.number().int().nonnegative(),
            policy: policyInput,
        })
        .strict()
        .parse(raw);
    return exec.transaction(async (tx) => {
        await activeCustomerActor(actor, tx);
        const channel = await operationsChannel(actor, id, tx);
        await requireCustomerAccess(actor, channel.workspaceId, "manage", tx);
        await tx
            .select({ id: channels.id })
            .from(channels)
            .where(eq(channels.id, id))
            .for("update");
        const [old] = await tx
            .select()
            .from(settings)
            .where(eq(settings.channelId, id))
            .for("update");
        if ((old?.version ?? 0) !== input.version)
            throw new InboxError(
                "다른 사람이 운영 설정을 변경했습니다. 최신 설정을 불러와주세요.",
                409,
            );
        const saved = {
            orgId: actor.orgId,
            channelId: id,
            version: input.version + 1,
            policy: input.policy,
            effectiveAt: now,
            updatedAt: now,
            updatedBy: actor.userId,
        };
        await tx
            .insert(settings)
            .values(saved)
            .onConflictDoUpdate({ target: settings.channelId, set: saved });
        await appendInboxAudit(tx, {
            orgId: actor.orgId,
            channelId: channel.id,
            actorId: actor.userId,
            actorName: actor.name,
            action: "operations.settings.updated",
            changes: {
                operations: {
                    before: old
                        ? { version: old.version, policy: old.policy }
                        : null,
                    after: { version: saved.version, policy: saved.policy },
                },
            },
        });
        return operationsSettings(actor, id, tx, now);
    });
}
export async function publicBusinessHours(
    channelId: number,
    exec: DbExec = db,
    now = new Date(),
) {
    const [saved] = await exec
        .select()
        .from(settings)
        .where(eq(settings.channelId, channelId));
    if (!saved?.policy.showHours) return null;
    return {
        timezone: saved.policy.calendar.timezone,
        ...businessAvailability(saved.policy.calendar, now),
        awayMessage: saved.policy.awayMessage,
    };
}
const effectiveRead = sql<Date | null>`CASE WHEN ${notices.readAt} IS NOT NULL THEN ${notices.readAt} WHEN ${notices.customerSeq} IS NOT NULL AND coalesce(${reads.customerSeq},0)>=${notices.customerSeq} THEN ${notices.createdAt} ELSE NULL END`;
function noticeScope(actor: OperationsActor, channelId?: number) {
    return and(
        eq(notices.orgId, actor.orgId),
        eq(notices.userId, actor.userId),
        customerAccessPredicate(
            actor.orgId,
            actor.userId,
            sql`(SELECT workspace_id FROM inbox_channels WHERE id=${notices.channelId})`,
        ),
        eq(chats.orgId, actor.orgId),
        eq(chats.channelId, notices.channelId),
        eq(chats.historyOnly, false),
        isNull(chats.mergedIntoId),
        sql`(${notices.type}='mentioned' OR coalesce(${crmContacts.isInternal},false)=false)`,
        channelId ? eq(notices.channelId, channelId) : undefined,
    );
}
function noticeQuery(exec: DbExec) {
    return exec
        .select({
            id: notices.id,
            conversationId: notices.conversationId,
            channelId: notices.channelId,
            messageId: notices.messageId,
            type: notices.type,
            preview: notices.preview,
            name: chats.name,
            status: chats.status,
            createdAt: notices.createdAt,
            readAt: effectiveRead,
        })
        .from(notices)
        .innerJoin(chats, eq(chats.id, notices.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .leftJoin(
            reads,
            and(
                eq(reads.conversationId, chats.id),
                eq(reads.userId, notices.userId),
            ),
        );
}
export async function notificationsPage(
    actor: OperationsActor,
    options: { channelId?: number; before?: string; unread?: boolean } = {},
    exec: DbExec = db,
) {
    await activeOperationsActor(actor, exec);
    if (options.channelId)
        await operationsChannel(actor, options.channelId, exec);
    const base = noticeScope(actor, options.channelId),
        unread = sql`${effectiveRead} IS NULL`;
    let cursor: typeof notices.$inferSelect | undefined;
    if (options.before) {
        z.uuid().parse(options.before);
        [cursor] = await exec
            .select()
            .from(notices)
            .where(
                and(
                    eq(notices.id, options.before),
                    eq(notices.orgId, actor.orgId),
                    eq(notices.userId, actor.userId),
                    customerAccessPredicate(
                        actor.orgId,
                        actor.userId,
                        sql`(SELECT workspace_id FROM inbox_channels WHERE id=${notices.channelId})`,
                    ),
                    options.channelId
                        ? eq(notices.channelId, options.channelId)
                        : undefined,
                ),
            );
        if (!cursor)
            throw new InboxError("알림 목록 위치를 확인해주세요.", 404);
    }
    const rows = await noticeQuery(exec)
        .where(
            and(
                base,
                options.unread ? unread : undefined,
                cursor
                    ? or(
                          lt(notices.createdAt, cursor.createdAt),
                          and(
                              eq(notices.createdAt, cursor.createdAt),
                              lt(notices.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(notices.createdAt), desc(notices.id))
        .limit(50);
    const [counts] = await exec
        .select({ unread: sql<number>`count(*)`.mapWith(Number) })
        .from(notices)
        .innerJoin(chats, eq(chats.id, notices.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .leftJoin(
            reads,
            and(
                eq(reads.conversationId, chats.id),
                eq(reads.userId, notices.userId),
            ),
        )
        .where(and(base, unread));
    return { rows, hasMore: rows.length === 50, unread: counts.unread };
}
export async function readNotifications(
    actor: OperationsActor,
    raw: unknown,
    channelId?: number,
    exec: DbExec = db,
    now = new Date(),
) {
    const input = z
            .object({
                action: z.literal("read"),
                ids: z.array(z.uuid()).min(1).max(100),
            })
            .strict()
            .parse(raw),
        ids = [...new Set(input.ids)];
    return exec.transaction(async (tx) => {
        await activeOperationsActor(actor, tx);
        const rows = await tx
            .select()
            .from(notices)
            .where(
                and(
                    inArray(notices.id, ids),
                    eq(notices.orgId, actor.orgId),
                    eq(notices.userId, actor.userId),
                    customerAccessPredicate(
                        actor.orgId,
                        actor.userId,
                        sql`(SELECT workspace_id FROM inbox_channels WHERE id=${notices.channelId})`,
                    ),
                    channelId ? eq(notices.channelId, channelId) : undefined,
                ),
            )
            .for("update");
        if (rows.length !== ids.length)
            throw new InboxError("읽음 처리할 알림을 확인해주세요.", 404);
        await tx
            .update(notices)
            .set({ readAt: now })
            .where(and(inArray(notices.id, ids), isNull(notices.readAt)));
        return { read: ids.length };
    });
}
function liveDue(c: typeof cases.$inferSelect, due: Date | null, now: Date) {
    if (!due || !c.pausedAt || c.pausedAt > due) return due;
    return addBusinessMilliseconds(
        c.policy.calendar,
        due,
        businessMilliseconds(c.policy.calendar, c.pausedAt, now),
    );
}
export async function conversationOperations(
    actor: OperationsActor,
    id: string,
    exec: DbExec = db,
    now = new Date(),
) {
    await activeOperationsActor(actor, exec);
    const [chat] = await exec
        .select()
        .from(chats)
        .where(
            and(
                eq(chats.id, id),
                eq(chats.orgId, actor.orgId),
                isNull(chats.mergedIntoId),
            ),
        );
    if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    const rows = await exec
            .select()
            .from(cases)
            .where(eq(cases.conversationId, id))
            .orderBy(desc(cases.startedAt), desc(cases.id))
            .limit(10),
        currentSettings = await operationsSettings(
            actor,
            chat.channelId,
            exec,
            now,
        );
    const result = [];
    for (const c of rows) {
        const waiting = await exec
            .select()
            .from(obligations)
            .where(
                and(
                    eq(obligations.caseId, c.id),
                    isNull(obligations.respondedAt),
                ),
            )
            .orderBy(obligations.startedAt);
        result.push({
            id: c.id,
            startedAt: c.startedAt,
            closedAt: c.closedAt,
            paused: !!c.pausedAt,
            policyVersion: c.policyVersion,
            slaApplied: c.slaApplied,
            firstReplyAt: c.firstReplyAt,
            firstReplyMs: c.firstReplyMs,
            firstResponder: c.firstResponder,
            resolutionDueAt: liveDue(c, c.resolutionDueAt, now),
            resolutionMs: c.resolutionMs,
            resolutionMissed:
                !!c.resolutionBreachedAt ||
                !!(
                    c.resolutionDueAt &&
                    (!c.pausedAt || c.pausedAt > c.resolutionDueAt) &&
                    (c.closedAt ?? now) > c.resolutionDueAt
                ),
            waiting: c.closedAt
                ? []
                : waiting.map((o) => ({
                      id: o.id,
                      kind: o.kind,
                      startedAt: o.startedAt,
                      dueAt: liveDue(c, o.dueAt, now),
                      missed:
                          !!o.breachedAt ||
                          !!(
                              o.dueAt &&
                              (!c.pausedAt || c.pausedAt > o.dueAt) &&
                              now > o.dueAt
                          ),
                  })),
        });
    }
    return {
        cases: result,
        settingsEnabled: currentSettings.policy.enabled,
        workerEnabled: currentSettings.workerEnabled,
        historyOnly: chat.historyOnly,
    };
}
