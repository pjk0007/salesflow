import { isValidYmd, previousRange } from "./date-range";
import type { AggregateRangeResult } from "./analytics-queries";
import type { ComparisonPeriod, KpiMetric, OverviewData } from "@/components/tracker/types/overview";

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

/** 날짜 검증은 집계 전에 수행한다. 각 기간은 KST 달력 날짜 양 끝을 포함한다. */
export function resolveComparisonPeriod(
    current: { from: string; to: string },
    compareFrom?: string | null,
    compareTo?: string | null,
    now = new Date(),
): ComparisonPeriod {
    if (!isValidYmd(current.from) || !isValidYmd(current.to) || current.from > current.to) {
        throw new Error("조회 기간의 시작일과 종료일을 확인해 주세요.");
    }
    const custom = compareFrom != null || compareTo != null;
    const previous = previousRange(current.from, current.to);
    const from = custom ? compareFrom : previous.fromYmd;
    const to = custom ? compareTo : previous.toYmd;
    const todayKst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!from || !to || !isValidYmd(from) || !isValidYmd(to) || from > to || (custom && to > todayKst)) {
        throw new Error("비교 기간은 오늘까지의 올바른 시작일과 종료일을 모두 선택해 주세요.");
    }
    const currentDays = days(current.from, current.to);
    const comparisonDays = days(from, to);
    return { from, to, mode: custom ? "custom" : "previous", currentDays, days: comparisonDays,
        countBasis: currentDays === comparisonDays ? "total" : "dailyAverage" };
}

function metric(value: number, comparisonValue: number, dailyAverage?: KpiMetric["dailyAverage"]): KpiMetric {
    const current = dailyAverage?.current ?? value;
    const comparison = dailyAverage?.comparison ?? comparisonValue;
    const deltaPct = comparison === 0 ? null : Number((((current - comparison) / comparison) * 100).toFixed(1));
    return { value, comparisonValue, deltaPct: Object.is(deltaPct, -0) ? 0 : deltaPct,
        ...(dailyAverage ? { dailyAverage } : {}) };
}

/** 건수만 기간 길이를 보정한다. 체류 평균과 전환율은 기존의 가중 집계를 유지한다. */
export function buildComparisonKpi(current: AggregateRangeResult, comparison: AggregateRangeResult, period: ComparisonPeriod): OverviewData["kpi"] {
    const count = (value: number, comparisonValue: number) => metric(value, comparisonValue,
        period.countBasis === "dailyAverage" ? { current: value / period.currentDays, comparison: comparisonValue / period.days } : undefined);
    const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : 0;
    return {
        visitors: count(current.visitors, comparison.visitors),
        sessions: count(current.sessions, comparison.sessions),
        pageviews: count(current.pageviews, comparison.pageviews),
        avgDwellSec: metric(current.avgDwell, comparison.avgDwell),
        bounceRate: metric(rate(current.bounces, current.sessions), rate(comparison.bounces, comparison.sessions)),
        leadRate: metric(rate(current.leads, current.visitors), rate(comparison.leads, comparison.visitors)),
        signupRate: metric(rate(current.signups, current.visitors), rate(comparison.signups, comparison.visitors)),
    };
}
