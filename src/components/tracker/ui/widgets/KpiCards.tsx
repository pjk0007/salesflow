"use client";

import { Users, MousePointer, Eye, Clock, CornerUpLeft, UserCheck, UserPlus, TrendingUp, TrendingDown } from "lucide-react";
import type { OverviewData, KpiMetric, ComparisonPeriod } from "../../types/overview";

function formatDwell(sec: number): string {
    if (sec <= 0) return "-";
    const rounded = Math.round(sec);
    const m = Math.floor(rounded / 60);
    const s = rounded % 60;
    if (m === 0) return `${s}초`;
    return `${m}분 ${s}초`;
}
function formatPct(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}
const formatCount = (value: number) => value.toLocaleString();
const formatAverage = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Card({
    icon: Icon,
    label,
    metric,
    formatValue,
    comparison,
    lowerIsBetter = false,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    metric: KpiMetric;
    formatValue: (value: number) => string;
    comparison: ComparisonPeriod;
    lowerIsBetter?: boolean;
}) {
    const delta = metric.deltaPct;
    const improved = delta === null || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0;
    const deltaText = delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
    const comparisonLabel = `${comparison.from} ~ ${comparison.to} 대비`;
    return (
        <div role="group" aria-label={`${label} 지표`} className="min-w-0 rounded-lg border bg-card p-4">
            <div title={lowerIsBetter ? "한 세션에서 유효 페이지를 한 페이지만 본 비율입니다." : undefined} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{formatValue(metric.value)}</div>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {metric.dailyAverage
                    ? `일평균 ${formatAverage(metric.dailyAverage.current)} · 비교 ${formatAverage(metric.dailyAverage.comparison)}`
                    : `비교 ${formatValue(metric.comparisonValue)}`}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                <span title={delta === null ? "비교 기간의 값이 0이어서 증감률을 계산할 수 없습니다." : undefined}
                    className={`inline-flex items-center gap-1 tabular-nums ${improved === null ? "text-muted-foreground" : improved ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {delta !== null && delta > 0 && <TrendingUp aria-label="상승" className="h-3 w-3" />}
                    {delta !== null && delta < 0 && <TrendingDown aria-label="하락" className="h-3 w-3" />}
                    {deltaText}
                </span>
                <span className="text-muted-foreground">{comparisonLabel}</span>
            </div>
        </div>
    );
}

export function KpiCards({ kpi, comparison }: { kpi: OverviewData["kpi"]; comparison: ComparisonPeriod }) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Card icon={Users} label="방문자" formatValue={formatCount} metric={kpi.visitors} comparison={comparison} />
            <Card icon={MousePointer} label="세션" formatValue={formatCount} metric={kpi.sessions} comparison={comparison} />
            <Card icon={Eye} label="페이지뷰" formatValue={formatCount} metric={kpi.pageviews} comparison={comparison} />
            <Card icon={Clock} label="평균 체류" formatValue={formatDwell} metric={kpi.avgDwellSec} comparison={comparison} />
            <Card icon={CornerUpLeft} label="이탈률" formatValue={formatPct} metric={kpi.bounceRate} comparison={comparison} lowerIsBetter />
            <Card icon={UserCheck} label="리드" formatValue={formatPct} metric={kpi.leadRate} comparison={comparison} />
            <Card icon={UserPlus} label="가입" formatValue={formatPct} metric={kpi.signupRate} comparison={comparison} />
        </div>
    );
}
