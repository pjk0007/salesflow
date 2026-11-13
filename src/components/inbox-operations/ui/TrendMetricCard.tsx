"use client";

import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import type { OperationsReport } from "../types";
import { durationParts } from "../utils/display";
import { formatMetric, gapText, type Metric } from "../utils/metrics";

const DAY = 86400000;
/** 기간의 모든 날 — 응대가 없던 날은 값 없음(점선으로 이어 보인다) */
function series(m: Metric, report: OperationsReport) {
    const byDay = new Map(report.daily.map((d) => [d.day, d]));
    const out: Array<{ day: string; v: number | null; gap: number | null }> = [];
    for (let t = Date.parse(`${report.period.from}T00:00:00Z`); t <= Date.parse(`${report.period.to}T00:00:00Z`); t += DAY) {
        const day = new Date(t).toISOString().slice(0, 10);
        const d = byDay.get(day);
        const v = d ? m.value(d) : null;
        out.push({ day, v, gap: v });
    }
    return out;
}

function BigValue({ m, v }: { m: Metric; v: number | null }) {
    if (v === null) return <span className="text-4xl font-semibold tracking-tight text-muted-foreground">—</span>;
    const parts =
        m.kind === "duration"
            ? durationParts(v)
            : [{ value: m.kind === "percent" ? Math.round(v * 10) / 10 : v, unit: m.kind === "percent" ? "%" : "건" }];
    return (
        <span className="flex items-baseline gap-1">
            {parts.map((p) => (
                <span key={p.unit} className="flex items-baseline">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums">{p.value.toLocaleString("ko-KR")}</span>
                    <span className="ml-0.5 text-lg font-medium">{p.unit}</span>
                </span>
            ))}
        </span>
    );
}

/** 이전 같은 길이 기간 대비 — 좋아졌으면 초록, 나빠졌으면 빨강 (건수는 회색) */
function Delta({ m, now, before, neutral }: { m: Metric; now: number | null; before: number | null | undefined; neutral?: boolean }) {
    if (now === null || before === null || before === undefined) return null;
    const d = now - before;
    if (Math.abs(d) < (m.kind === "duration" ? 1000 : 0.05)) return <span className="text-sm text-muted-foreground">변화 없음</span>;
    const better = m.lowerIsBetter ? d < 0 : d > 0;
    const Icon = d < 0 ? ArrowDown : ArrowUp;
    return (
        <InfoTip text={`이전 기간 ${formatMetric(m, before)} 대비`}>
            <span className={cn("flex items-center gap-0.5 text-sm font-semibold", neutral ? "text-muted-foreground" : better ? "text-emerald-600" : "text-red-600")}>
                <Icon className="size-3.5" />
                {gapText(m, Math.abs(d))}
            </span>
        </InfoTip>
    );
}

/** 지표 카드 — 큰 숫자 + 이전 기간 대비 + 일별 추세 */
export function TrendMetricCard({ m, report, previous }: { m: Metric; report: OperationsReport; previous?: OperationsReport }) {
    const now = m.value(report.summary);
    const data = series(m, report);
    return (
        <section className="rounded-lg border border-border/40 bg-card p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                {m.label}
                <InfoTip text={m.tooltip} />
            </h2>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <BigValue m={m} v={now} />
                <Delta m={m} now={now} before={previous ? m.value(previous.summary) : undefined} />
            </div>
            <div className="mt-4 h-28">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <XAxis dataKey="day" hide />
                        <YAxis hide domain={[0, "auto"]} />
                        <Tooltip
                            formatter={(v) => [formatMetric(m, typeof v === "number" ? v : null), m.label]}
                            labelFormatter={(d) => String(d)}
                            contentStyle={{ borderRadius: 8, borderColor: "var(--border)", fontSize: 12 }}
                        />
                        {/* 응대가 없던 날은 점선으로 잇는다 */}
                        <Line dataKey="gap" stroke="var(--chart-1)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls isAnimationActive={false} tooltipType="none" />
                        <Area dataKey="v" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.08} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </section>
    );
}

/** 작은 카드 — 건수 */
export function CountCard({ m, report, previous }: { m: Metric; report: OperationsReport; previous?: OperationsReport }) {
    const now = m.value(report.summary);
    return (
        <section className="rounded-lg border border-border/40 bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {m.label}
                <InfoTip text={m.tooltip} />
            </h2>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{(now ?? 0).toLocaleString("ko-KR")}</span>
                <span className="text-sm text-muted-foreground">건</span>
                {previous && <Delta m={m} now={now} before={m.value(previous.summary)} neutral />}
            </div>
        </section>
    );
}
