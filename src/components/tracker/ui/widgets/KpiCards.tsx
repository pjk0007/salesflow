"use client";

import { Users, MousePointer, Eye, Clock, CornerUpLeft, UserCheck, UserPlus, TrendingUp, TrendingDown } from "lucide-react";
import type { OverviewData, KpiMetric } from "../../types/overview";

function formatDwell(sec: number): string {
    if (sec <= 0) return "-";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}초`;
    return `${m}분 ${s}초`;
}
function formatPct(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}
function formatDelta(d: number | null): { text: string; positive: boolean | null } {
    if (d === null) return { text: "—", positive: null };
    const positive = d >= 0;
    return { text: `${positive ? "+" : ""}${d.toFixed(1)}%`, positive };
}

function Card({
    icon: Icon,
    label,
    value,
    metric,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    metric: KpiMetric;
}) {
    const delta = formatDelta(metric.deltaPct);
    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
            <div className={`mt-1 inline-flex items-center gap-1 text-[11px] ${
                delta.positive === null
                    ? "text-muted-foreground"
                    : delta.positive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
            }`}>
                {delta.positive === true && <TrendingUp className="h-3 w-3" />}
                {delta.positive === false && <TrendingDown className="h-3 w-3" />}
                {delta.text}
            </div>
        </div>
    );
}

export function KpiCards({ kpi }: { kpi: OverviewData["kpi"] }) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Card icon={Users} label="방문자" value={kpi.visitors.value.toLocaleString()} metric={kpi.visitors} />
            <Card icon={MousePointer} label="세션" value={kpi.sessions.value.toLocaleString()} metric={kpi.sessions} />
            <Card icon={Eye} label="페이지뷰" value={kpi.pageviews.value.toLocaleString()} metric={kpi.pageviews} />
            <Card icon={Clock} label="평균 체류" value={formatDwell(kpi.avgDwellSec.value)} metric={kpi.avgDwellSec} />
            <Card icon={CornerUpLeft} label="바운스율" value={formatPct(kpi.bounceRate.value)} metric={kpi.bounceRate} />
            <Card icon={UserCheck} label="리드" value={formatPct(kpi.leadRate.value)} metric={kpi.leadRate} />
            <Card icon={UserPlus} label="가입" value={formatPct(kpi.signupRate.value)} metric={kpi.signupRate} />
        </div>
    );
}
