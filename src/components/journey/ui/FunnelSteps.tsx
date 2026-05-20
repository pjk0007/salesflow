import { ChevronRight } from "lucide-react";
import type { StageDuration } from "../types";

/**
 * 퍼널 단계 계단. 정의된 순서(stages)대로, 도달한 단계는 강조.
 * 단계 사이에 소요일(stageDurations) 표시.
 */
export function FunnelSteps({
    stages,
    reachedStages,
    currentStage,
    stageDurations,
}: {
    stages: string[];
    reachedStages: string[];
    currentStage: string | null;
    stageDurations: StageDuration[];
}) {
    // 정의된 순서가 없으면 도달 순서로 폴백
    const ordered = stages.length ? stages : reachedStages;
    if (ordered.length === 0) return null;

    const durByTo = new Map(stageDurations.map((d) => [d.to, d.days]));

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {ordered.map((stage, i) => {
                const reached = reachedStages.includes(stage);
                const isCurrent = stage === currentStage;
                const days = durByTo.get(stage);
                return (
                    <div key={stage} className="flex items-center gap-1.5">
                        {i > 0 && (
                            <div className="flex items-center text-xs text-muted-foreground">
                                {days != null && <span className="mr-1">{days}일</span>}
                                <ChevronRight className="h-3.5 w-3.5" />
                            </div>
                        )}
                        <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium border ${
                                isCurrent
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : reached
                                        ? "bg-primary/10 text-primary border-primary/30"
                                        : "bg-muted text-muted-foreground border-border"
                            }`}
                        >
                            {stage}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
