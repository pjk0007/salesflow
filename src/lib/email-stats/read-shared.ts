import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type postgres from "postgres";
import { queryClient } from "../db";
import type { StatsQuery, StatsEnvelope, StatCounts } from "@/components/email/dashboard/types";
import { STAT_COUNT_KEYS } from "./metrics";
import { previousRange } from "../tracker/date-range";
import { kstToday } from "./rules";
import { statsConnections } from "./connections";
export const sumColumns = sql.join(STAT_COUNT_KEYS.map((key) => {
    const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    return sql`COALESCE(sum(${sql.raw(column)}),0)::int AS ${sql.identifier(key)}`;
}), sql`, `);

export async function readRows<T extends object>(fragment: SQL): Promise<T[]> {
    const query = new PgDialect().sqlToQuery(fragment);
    return queryClient.unsafe<T[]>(query.sql, query.params as postgres.ParameterOrJSON<never>[]);
}

export function statsWhere(orgId: string, query: StatsQuery): SQL {
    return sql`org_id=${orgId}::uuid AND stat_date BETWEEN ${query.from}::date AND ${query.to}::date
        AND (${query.workspaceId}::int IS NULL OR workspace_id=${query.workspaceId}::int)`;
}

export async function totalCounts(orgId: string, query: StatsQuery): Promise<StatCounts> {
    const [row] = await readRows<StatCounts>(sql`SELECT ${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND grain='total'`);
    return row;
}

export async function statsEnvelope(orgId: string, query: StatsQuery): Promise<StatsEnvelope> {
    const [states, connections] = await Promise.all([
        queryClient<{
            filled_from: string | null;
            backfill_done_at: string | null;
            recent_done_at: string | null;
        }[]> `SELECT filled_from::text,backfill_done_at::text,recent_done_at::text FROM email_stats_state WHERE org_id=${orgId}`,
        statsConnections(orgId, query.workspaceId),
    ]);
    const state = states[0];
    const previous = previousRange(query.from, query.to);
    return {
        range: {
            from: query.from,
            to: query.to,
            days: (Date.parse(query.to) - Date.parse(query.from)) / 86400000 + 1
        },
        comparison: { from: previous.fromYmd, to: previous.toYmd },
        asOf: state?.recent_done_at ? new Date(state.recent_done_at).toISOString() : null,
        coverage: state?.recent_done_at && (state.filled_from || state.backfill_done_at)
            ? {
                from: state.backfill_done_at ? null : state.filled_from,
                to: kstToday(new Date(state.recent_done_at))
            } : null,
        connections,
    };
}
