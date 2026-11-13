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

/** 고른 메일들(쉼표로 이은 "종류:번호") 중 하나인 행 */
export function campaignIn(campaign: string): SQL {
    return sql`campaign_kind||':'||campaign_id = ANY(string_to_array(${campaign}, ','))`;
}

/** 전체(total 행) 또는 고른 메일들(campaign 행 — 후속 단계 행을 모두 더한다) */
export function scopeGrain(query: StatsQuery): SQL {
    return query.campaign
        ? sql`grain='campaign' AND ${campaignIn(query.campaign)}`
        : sql`grain='total'`;
}

export async function totalCounts(orgId: string, query: StatsQuery): Promise<StatCounts> {
    const [row] = await readRows<StatCounts>(sql`SELECT ${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND ${scopeGrain(query)}`);
    return row;
}

/** 집계 상태 한 줄 — 기준 시각(asOf)은 recent_done_at. 이메일 통계 화면과 홈 발송 분석이 같은 값을 쓴다 */
export async function readStatsState(orgId: string) {
    const states = await queryClient<{
        filled_from: string | null;
        backfill_done_at: string | null;
        recent_done_at: string | null;
    }[]> `SELECT filled_from::text,backfill_done_at::text,recent_done_at::text FROM email_stats_state WHERE org_id=${orgId}`;
    return states[0];
}

export async function statsEnvelope(orgId: string, query: StatsQuery): Promise<StatsEnvelope> {
    const [state, connections] = await Promise.all([
        readStatsState(orgId),
        statsConnections(orgId, query.workspaceId),
    ]);
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
