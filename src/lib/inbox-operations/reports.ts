import { and, eq, sql, desc, lt, or, isNull } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxServiceCases as cases,
    inboxResponseObligations as obligations,
    inboxConversations as chats,
    crmContacts,
    inboxMessages as messages,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import { operationsSettings, type OperationsActor } from "./repository";
import { reportDates, zonedBoundary, shiftDay } from "./calendar";
const count = (condition = sql`true`) =>
    sql<number>`count(*) FILTER (WHERE ${condition})`.mapWith(Number);
const median = (
    column: typeof cases.firstReplyMs | typeof cases.resolutionMs,
) =>
    sql<
        number | null
    >`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${column}) FILTER (WHERE ${column} IS NOT NULL)`.mapWith(
        Number,
    );
export async function operationsReport(
    actor: OperationsActor,
    channelId: number,
    raw: { from: string; to: string; before?: string; medium?: string },
    exec: DbExec = db,
    now = new Date(),
) {
    const dates = reportDates.parse(raw),
        settings = await operationsSettings(actor, channelId, exec, now),
        zone = settings.policy.calendar.timezone,
        from = zonedBoundary(dates.from, "00:00", zone),
        to = zonedBoundary(shiftDay(dates.to, 1), "00:00", zone),
        medium = z.enum(["web", "email", "all"]).parse(raw.medium ?? "all");
    const scope = and(
        eq(cases.orgId, actor.orgId),
        eq(cases.channelId, channelId),
        eq(chats.historyOnly, false),
        isNull(chats.mergedIntoId),
        sql`coalesce(${crmContacts.isInternal},false)=false`,
        sql`${cases.startedAt}>=${from.toISOString()}::timestamptz`,
        sql`${cases.startedAt}<${to.toISOString()}::timestamptz`,
        medium !== "all" ? eq(chats.medium, medium) : undefined,
    );
    const lateResolution = sql`(${cases.resolutionBreachedAt} IS NOT NULL OR (${cases.resolutionDueAt} IS NOT NULL AND coalesce(${cases.closedAt},${now.toISOString()}::timestamptz)>${cases.resolutionDueAt} AND (${cases.pausedAt} IS NULL OR ${cases.pausedAt}>${cases.resolutionDueAt})))`;
    const stats = {
        started: count(),
        closed: count(sql`${cases.closedAt} IS NOT NULL`),
        open: count(sql`${cases.closedAt} IS NULL`),
        firstReplySamples: count(sql`${cases.firstReplyMs} IS NOT NULL`),
        firstReplyMedianMs: median(cases.firstReplyMs),
        resolutionSamples: count(sql`${cases.resolutionMs} IS NOT NULL`),
        resolutionMedianMs: median(cases.resolutionMs),
        closedUnanswered: count(
            sql`${cases.closedAt} IS NOT NULL AND EXISTS(SELECT 1 FROM ${obligations} WHERE ${obligations.caseId}=${cases.id} AND ${obligations.respondedAt} IS NULL)`,
        ),
        resolutionTargets: count(sql`${cases.resolutionDueAt} IS NOT NULL`),
        resolutionMet: count(
            sql`${cases.resolutionDueAt} IS NOT NULL AND ${cases.closedAt}<=${cases.resolutionDueAt}`,
        ),
        resolutionMissed: count(lateResolution),
        paused: count(
            sql`${cases.closedAt} IS NULL AND ${cases.pausedAt} IS NOT NULL`,
        ),
        aiFirst: count(sql`${cases.firstResponder}='ai'`),
    };
    const base = () =>
        exec
            .select(stats)
            .from(cases)
            .innerJoin(chats, eq(chats.id, cases.conversationId))
            .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId));
    const [summary] = await base().where(scope);
    const lateResponse = sql`(${obligations.breachedAt} IS NOT NULL OR (${obligations.dueAt} IS NOT NULL AND (${obligations.respondedAt}>${obligations.dueAt} OR (${obligations.respondedAt} IS NULL AND ${cases.closedAt} IS NULL AND ${obligations.dueAt}<${now.toISOString()}::timestamptz AND (${cases.pausedAt} IS NULL OR ${cases.pausedAt}>${obligations.dueAt})))))`;
    const responseStats = await exec
        .select({
            kind: obligations.kind,
            total: count(),
            targets: count(sql`${obligations.dueAt} IS NOT NULL`),
            met: count(
                sql`${obligations.dueAt} IS NOT NULL AND ${obligations.respondedAt}<=${obligations.dueAt}`,
            ),
            missed: count(lateResponse),
            awaiting: count(
                sql`${obligations.respondedAt} IS NULL AND ${cases.closedAt} IS NULL`,
            ),
            closedUnanswered: count(
                sql`${obligations.respondedAt} IS NULL AND ${cases.closedAt} IS NOT NULL`,
            ),
            samples: count(sql`${obligations.elapsedMs} IS NOT NULL`),
            medianMs: sql<
                number | null
            >`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${obligations.elapsedMs}) FILTER (WHERE ${obligations.elapsedMs} IS NOT NULL)`.mapWith(
                Number,
            ),
        })
        .from(obligations)
        .innerJoin(cases, eq(cases.id, obligations.caseId))
        .innerJoin(chats, eq(chats.id, cases.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .where(scope)
        .groupBy(obligations.kind);
    const day =
        sql<string>`to_char(${cases.startedAt} AT TIME ZONE ${zone},'YYYY-MM-DD')`.as(
            "day",
        );
    const daily = await exec
        .select({ day, ...stats })
        .from(cases)
        .innerJoin(chats, eq(chats.id, cases.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .where(scope)
        .groupBy(sql`"day"`)
        .orderBy(sql`"day"`);
    const assignee = sql<
        string | null
    >`CASE WHEN ${cases.closedAt} IS NOT NULL THEN ${cases.assigneeAtClose} ELSE ${chats.assigneeId} END`;
    const teammates = await exec
        .select({ id: assignee, name: users.name, ...stats })
        .from(cases)
        .innerJoin(chats, eq(chats.id, cases.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .leftJoin(users, eq(users.id, assignee))
        .where(scope)
        .groupBy(assignee, users.name);
    let cursor: typeof cases.$inferSelect | undefined;
    if (raw.before) {
        z.uuid().parse(raw.before);
        [cursor] = await exec
            .select()
            .from(cases)
            .where(
                and(
                    eq(cases.id, raw.before),
                    eq(cases.orgId, actor.orgId),
                    eq(cases.channelId, channelId),
                    sql`${cases.startedAt}>=${from.toISOString()}::timestamptz`,
                    sql`${cases.startedAt}<${to.toISOString()}::timestamptz`,
                ),
            );
        if (!cursor)
            throw new InboxError("성과 목록 위치를 확인해주세요.", 404);
    }
    const rows = await exec
        .select({
            id: cases.id,
            conversationId: cases.conversationId,
            channelId: cases.channelId,
            name: chats.name,
            medium: chats.medium,
            status: chats.status,
            startedAt: cases.startedAt,
            closedAt: cases.closedAt,
            firstReplyMs: cases.firstReplyMs,
            firstResponder: cases.firstResponder,
            resolutionMs: cases.resolutionMs,
            resolutionMissed: lateResolution,
            policyVersion: cases.policyVersion,
            slaApplied: cases.slaApplied,
        })
        .from(cases)
        .innerJoin(chats, eq(chats.id, cases.conversationId))
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .where(
            and(
                scope,
                cursor
                    ? or(
                          lt(cases.startedAt, cursor.startedAt),
                          and(
                              eq(cases.startedAt, cursor.startedAt),
                              lt(cases.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(cases.startedAt), desc(cases.id))
        .limit(100);
    const [coverage] = await exec
        .select({
            untracked: count(
                sql`NOT EXISTS(SELECT 1 FROM ${cases} WHERE ${cases.conversationId}=${chats.id})`,
            ),
        })
        .from(chats)
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .where(
            and(
                eq(chats.orgId, actor.orgId),
                eq(chats.channelId, channelId),
                eq(chats.historyOnly, false),
                isNull(chats.mergedIntoId),
                sql`coalesce(${crmContacts.isInternal},false)=false`,
                medium !== "all" ? eq(chats.medium, medium) : undefined,
                sql`EXISTS(SELECT 1 FROM ${messages} WHERE ${messages.conversationId}=${chats.id} AND ${messages.kind}='customer' AND ${messages.createdAt}>=${from.toISOString()}::timestamptz AND ${messages.createdAt}<${to.toISOString()}::timestamptz)`,
            ),
        );
    return {
        period: { ...dates, timezone: zone, fromAt: from, toAt: to },
        summary,
        response: responseStats,
        daily,
        teammates,
        rows,
        hasMore: rows.length === 100,
        coverage,
        workerEnabled: settings.workerEnabled,
    };
}
