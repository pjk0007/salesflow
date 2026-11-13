"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareCards } from "@/components/leadgen/ui/CompareCards";
import { GROUPS, compareCard } from "@/components/leadgen/utils/groups";
import { useOperationsReports } from "../hooks/useOperations";
import type { StatsGroup } from "../hooks/useStatsFilters";
import { COUNT_METRICS, TREND_METRICS, formatMetric, gapText } from "../utils/metrics";

/** 기간·매체 비교 — A·B·C 묶음별 지표 카드 (가장 나은 값 굵게) */
export function StatsCompare({ channelId, groups }: { channelId: number; groups: StatsGroup[] }) {
    const r = useOperationsReports(
        channelId,
        groups.map((g) => g.query),
    );
    if (r.error)
        return (
            <div role="alert" className="flex items-center gap-3 text-sm">
                응대 성과를 불러오지 못했습니다.{" "}
                <Button variant="outline" onClick={() => void r.mutate()}>
                    다시 불러오기
                </Button>
            </div>
        );
    if (!r.data)
        return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
            </div>
        );
    const reports = r.data;
    const cards = [...TREND_METRICS, ...COUNT_METRICS].map((m) =>
        compareCard({
            key: m.key,
            label: m.label,
            tooltip: m.tooltip,
            groups: groups.map((g) => g.index),
            values: reports.map((x) => m.value(x.summary)),
            format: (v) => formatMetric(m, v),
            gap: (d) => gapText(m, d),
            lowerIsBetter: m.lowerIsBetter,
            word: m.kind === "count" ? "많아요" : m.lowerIsBetter ? (m.kind === "percent" ? "낮아요" : "빨라요") : "높아요",
        }),
    );
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {groups.map((g) => (
                    <span key={g.index} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: GROUPS[g.index].color }} />
                        {GROUPS[g.index].letter} {g.name}
                    </span>
                ))}
            </div>
            <CompareCards cards={cards} />
        </div>
    );
}
