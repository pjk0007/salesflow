import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { inboxAgentAvailability, users } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
export const openWorkload = (
    channelId: number,
    userId: string | SQLWrapper,
    excludeConversationId?: string,
) =>
    sql<number>`(SELECT count(*)::integer FROM inbox_conversations ic WHERE ic.channel_id=${channelId} AND ic.assignee_id=${userId}::uuid AND ic.status='open' AND ic.history_only=false AND ic.merged_into_id IS NULL ${excludeConversationId ? sql`AND ic.id<>${excludeConversationId}::uuid` : sql``})`.mapWith(
        Number,
    );
export const hasCapacity = (
    channelId: number,
    userId: string | SQLWrapper,
    excludeConversationId?: string,
) =>
    sql`NOT EXISTS (SELECT 1 FROM inbox_agent_availability ica WHERE ica.channel_id=${channelId} AND ica.user_id=${userId}::uuid AND ica.max_open_conversations IS NOT NULL AND ${openWorkload(channelId, userId, excludeConversationId)} >= ica.max_open_conversations)`;
const capacityLock = (channelId: number, userId: string) =>
    sql`hashtextextended(${`sendb-inbox-capacity:${channelId}:${userId}`},0)`;
export async function lockCapacitySettings(
    exec: DbExec,
    channelId: number,
    userId: string,
) {
    await exec.execute(
        sql`SELECT pg_advisory_xact_lock(${capacityLock(channelId, userId)})`,
    );
}
export async function claimCapacity(
    exec: DbExec,
    channelId: number,
    userId: string,
    excludeConversationId?: string,
) {
    const [config] = await exec
        .select({ limit: inboxAgentAvailability.maxOpenConversations })
        .from(inboxAgentAvailability)
        .where(
            and(
                eq(inboxAgentAvailability.channelId, channelId),
                eq(inboxAgentAvailability.userId, userId),
            ),
        );
    if (config?.limit == null) return true;
    // A busy limited agent remains in the queue for the next dispatch; do not wait while holding a team/chat lock.
    const [lock] = await exec
        .select({
            acquired: sql<boolean>`pg_try_advisory_xact_lock(${capacityLock(channelId, userId)})`,
        })
        .from(users)
        .where(eq(users.id, userId));
    if (!lock?.acquired) return false;
    const [fresh] = await exec
        .select({
            ready: hasCapacity(channelId, userId, excludeConversationId),
        })
        .from(users)
        .where(eq(users.id, userId));
    return fresh?.ready ?? false;
}
