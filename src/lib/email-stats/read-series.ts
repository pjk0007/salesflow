import { sql } from "drizzle-orm";
import type { CompareAxis, CompareData, CompareRow, StatCounts, StatsQuery, TrendData } from "@/components/email/dashboard/types";
import { addDaysYmd } from "../kst";
import { coverageStatus, deriveRates, emptyCounts, isMaturing, sumCounts } from "./metrics";
import { comparisonNames } from "./names";
import { campaignIn, readRows, scopeGrain, statsEnvelope, statsWhere, sumColumns, totalCounts } from "./read-shared";
const AXES: Record<CompareAxis, {
    grain: string;
    key: string;
}> = {
    campaign: { grain: "campaign", key: "campaign_kind||':'||campaign_id" },
    step: { grain: "campaign", key: "step_index::text" },
    partition: { grain: "partition", key: "partition_id::text" },
    sender: { grain: "sender", key: "sender_profile_id::text" },
    domain: { grain: "sender", key: "sender_domain" },
    trigger: { grain: "trigger", key: "trigger_type" },
    date: { grain: "total", key: "stat_date::text" },
};

export async function readTrend(orgId: string, query: StatsQuery, now = new Date()): Promise<TrendData> {
    const [envelope, rows] = await Promise.all([
        statsEnvelope(orgId, query),
        readRows<StatCounts & {
            date: string;
        }>(sql`SELECT stat_date::text AS date,${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND ${scopeGrain(query)}
            GROUP BY stat_date ORDER BY stat_date`),
    ]);
    const map = new Map(rows.map(({ date, ...counts }) => [date, counts]));
    const points: TrendData["points"] = [];
    for (let date = query.from;date <= query.to;date = addDaysYmd(date, 1)) {
        const counts = map.get(date) ?? emptyCounts();
        points.push({
            date,
            counts,
            rates: deriveRates(counts),
            ready: coverageStatus({ from: date, to: date }, envelope.coverage) === "full",
            maturing: isMaturing(date, now)
        });
    }
    return { ...envelope, points };
}

export async function readCompare(orgId: string, query: StatsQuery, axis: CompareAxis): Promise<CompareData> {
    const spec = AXES[axis];
    // 메일 하나를 골랐으면 메일 단위로 쌓인 축(메일·후속 단계)만 그 메일로 좁힌다. 합계도 그 메일 기준
    const campaignFilter = query.campaign && spec.grain === "campaign" ? sql`AND ${campaignIn(query.campaign)}` : sql``;
    const [envelope, groups, total] = await Promise.all([
        statsEnvelope(orgId, query),
        readRows<StatCounts & {
            key: string;
        }>(sql`SELECT ${sql.raw(spec.key)} AS key,${sumColumns} FROM email_stats_daily WHERE ${statsWhere(orgId, query)} AND
            grain=${spec.grain} ${campaignFilter} GROUP BY 1 ORDER BY sum(accepted) DESC,1`),
        totalCounts(orgId, spec.grain === "campaign" ? query : { ...query, campaign: null }),
    ]);
    const shown = groups.slice(0, 500);
    const names = await comparisonNames(orgId, axis, shown.map((row) => row.key));
    const rows: CompareRow[] = shown.map(({ key, ...counts }) => ({ key, ...names.get(key)!, counts, rates: deriveRates(counts) }));
    const restCount = Math.max(0, groups.length - 500);
    if (restCount) {
        const counts = sumCounts(groups.slice(500));
        rows.push({
            key: "__rest",
            label: `그 밖 ${restCount}개`,
            sublabel: null,
            deleted: false,
            counts,
            rates: deriveRates(counts)
        });
    }
    return {
        ...envelope,
        axis,
        rows,
        restCount,
        replyBasis: axis === "step" || axis === "trigger" ? "perSend" : "sequence",
        currentCoverage: coverageStatus(query, envelope.coverage),
        total: {
            key: "__total",
            label: "합계",
            sublabel: null,
            deleted: false,
            counts: total,
            rates: deriveRates(total)
        }
    };
}
