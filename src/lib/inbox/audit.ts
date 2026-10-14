import { and, desc, eq, lt, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, inboxAuditEvents as events } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "./errors";
export type AuditChanges = typeof events.$inferInsert.changes;
export async function appendInboxAudit(
    exec: DbExec,
    input: typeof events.$inferInsert,
) {
    if (Object.keys(input.changes).length)
        await exec.insert(events).values(input);
}
export async function inboxAuditPage(
    orgId: string,
    channelId: number,
    conversationId: string | null,
    before?: string,
    exec: DbExec = db,
) {
    const base = and(
        eq(events.orgId, orgId),
        eq(events.channelId, channelId),
        conversationId
            ? eq(events.conversationId, conversationId)
            : isNull(events.conversationId),
    );
    let cursor;
    if (before) {
        z.string().uuid().parse(before);
        [cursor] = await exec
            .select()
            .from(events)
            .where(and(base, eq(events.id, before)));
        if (!cursor)
            throw new InboxError("변경 이력 위치를 확인해주세요.", 404);
    }
    const rows = await exec
        .select({
            id: events.id,
            actorName: events.actorName,
            action: events.action,
            changes: events.changes,
            createdAt: events.createdAt,
        })
        .from(events)
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(events.createdAt, cursor.createdAt),
                          and(
                              eq(events.createdAt, cursor.createdAt),
                              lt(events.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(events.createdAt), desc(events.id))
        .limit(100);
    return { rows, hasMore: rows.length === 100 };
}
