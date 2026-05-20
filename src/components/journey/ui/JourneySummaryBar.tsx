import { AlertTriangle } from "lucide-react";
import type { JourneySummary } from "../types";
import { FunnelSteps } from "./FunnelSteps";
import { formatDwell, formatClickRate } from "../utils/format";

/**
 * L1 — 한눈에 요약: 현재 단계, 퍼널 계단, 핵심 지표, 이탈 경고.
 */
export function JourneySummaryBar({ summary }: { summary: JourneySummary }) {
    const { density, inactivity } = summary;

    const chips: string[] = [];
    if (summary.daysToConvert != null) chips.push(`전환 ${summary.daysToConvert}일`);
    if (summary.firstChannel) chips.push(`첫 유입 ${summary.firstChannel}`);
    chips.push(`방문 ${density.visits}`);
    chips.push(`메일 클릭 ${density.emailClicks}/${density.emailSent} (${formatClickRate(density.emailClickRate)})`);
    if (density.avgDwellSec) chips.push(`평균 체류 ${formatDwell(density.avgDwellSec)}`);
    if (density.sessions) chips.push(`세션 ${density.sessions}`);
    chips.push(`활동 ${summary.totalEvents}`);

    return (
        <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                {summary.currentStage && (
                    <span className="text-xs text-muted-foreground">현재 단계</span>
                )}
                {summary.currentStage && (
                    <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                        {summary.currentStage}
                    </span>
                )}
            </div>

            <FunnelSteps
                stages={summary.stages}
                reachedStages={summary.reachedStages}
                currentStage={summary.currentStage}
                stageDurations={summary.stageDurations}
            />

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {chips.map((c, i) => (
                    <span key={i} className="whitespace-nowrap">
                        {c}
                    </span>
                ))}
            </div>

            {inactivity.isStale && inactivity.lastActiveAt && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {inactivity.daysSince}일째 무활동
                </div>
            )}
        </div>
    );
}
