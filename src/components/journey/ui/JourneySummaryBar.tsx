import { AlertTriangle, Clock, MousePointerClick, Layers, Timer } from "lucide-react";
import type { JourneySummary } from "../types";
import { FunnelSteps } from "./FunnelSteps";
import { formatDwell, formatClickRate } from "../utils/format";

/**
 * L1 — 핵심 지표 카드 + 퍼널 계단 + 이탈 경고.
 */
export function JourneySummaryBar({ summary }: { summary: JourneySummary }) {
    const { density, inactivity } = summary;

    const metrics = [
        {
            icon: Clock,
            value: summary.daysToConvert != null ? `${summary.daysToConvert}일` : "—",
            label: "전환 소요",
            sub: summary.firstChannel ? `첫 유입 ${summary.firstChannel}` : undefined,
        },
        {
            icon: MousePointerClick,
            value: formatClickRate(density.emailClickRate),
            label: "메일 클릭률",
            sub: `${density.emailClicks}/${density.emailSent} 클릭`,
        },
        {
            icon: Layers,
            value: `${density.sessions}회`,
            label: "총 세션",
            sub: `방문 ${density.visits} · 활동 ${summary.totalEvents}`,
        },
        {
            icon: Timer,
            value: density.avgDwellSec ? formatDwell(density.avgDwellSec) : "—",
            label: "평균 체류",
        },
    ];

    return (
        <div className="space-y-3">
            {/* 지표 카드 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {metrics.map((m, i) => {
                    const Icon = m.icon;
                    return (
                        <div key={i} className="rounded-lg border bg-card p-3">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Icon className="h-3.5 w-3.5" />
                                {m.label}
                            </div>
                            <div className="mt-1 text-xl font-bold">{m.value}</div>
                            {m.sub && <div className="text-[11px] text-muted-foreground">{m.sub}</div>}
                        </div>
                    );
                })}
            </div>

            {/* 퍼널 */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">퍼널 단계</p>
                <FunnelSteps
                    stages={summary.stages}
                    reachedStages={summary.reachedStages}
                    currentStage={summary.currentStage}
                    stageDurations={summary.stageDurations}
                />
                {inactivity.isStale && inactivity.lastActiveAt && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 pt-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {inactivity.daysSince}일째 무활동
                    </div>
                )}
            </div>
        </div>
    );
}
