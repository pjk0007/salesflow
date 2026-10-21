import { sql } from "drizzle-orm";
import type { StatCounts, StatsQuery } from "@/components/email/dashboard/types";
import { readRows, statsWhere, sumColumns, totalCounts } from "./read-shared";
import { comparisonNames } from "./names";
import { emailSummary, templateSummary, triggerSummary } from "./home-map";
import { isValidYmd } from "../tracker/date-range";

export function homeRange(from: string | null, to: string | null): StatsQuery | null {
    return from && to && isValidYmd(from) && isValidYmd(to) && from <= to ? { from, to, workspaceId: null } : null;
}

export async function homeSummary(orgId: string, query: StatsQuery) {
    const [total, triggers, records] = await Promise.all([
        totalCounts(orgId, query),
        readRows<StatCounts & {
            trigger: string;
        }>(sql`SELECT trigger_type AS trigger,${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND grain='trigger'
            GROUP BY trigger_type`),
        readRows<{
            count: number;
        }>(sql`SELECT COALESCE(sum(total),0)::int count FROM home_stats_daily WHERE org_id=${orgId}::uuid AND stat_date BETWEEN
            ${query.from}::date AND ${query.to}::date AND source='records'`),
    ]);
    return {
        email: emailSummary(total),
        triggerBreakdown: triggers.map((row) => triggerSummary(row.trigger, row)),
        newRecordsInPeriod: records[0].count
    };
}

export async function homeTrends(orgId: string, query: StatsQuery) {
    return readRows<StatCounts & {
        date: string;
    }>(sql`SELECT stat_date::text AS date,${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND grain='total'
            GROUP BY stat_date ORDER BY stat_date`);
}

export async function homeTemplates(orgId: string, query: StatsQuery) {
    const groups = await readRows<StatCounts & {
        key: string;
        kind: string;
    }>(sql`SELECT campaign_kind||':'||campaign_id AS key,campaign_kind AS kind,${sumColumns}
        FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND grain='campaign' AND campaign_kind IN
            ('ai','template') GROUP BY campaign_kind,campaign_id`);
    const names = await comparisonNames(orgId, "campaign", groups.map((row) => row.key));
    return groups.flatMap((row) => {
        const item = templateSummary(row.kind, names.get(row.key)!.label, row);
        return item ? [item] : [];
    });
}
