import { RotateCw } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import type { StatsQuery } from "../types";
import { useEmailStatsKpi } from "../hooks/useEmailStatsKpi";
import { useEmailStatsRefresh } from "../hooks/useEmailStatsRefresh";

/** 집계 기준 한 줄 — "집계 기준 17:05 · ↻ 갱신" (제목 옆에 작게) */
export function StatsFreshness({ query }: { query: StatsQuery }) {
    const { freshness } = useEmailStatsKpi(query);
    const refresh = useEmailStatsRefresh();
    return <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" aria-live="polite">
        <span className={freshness?.isStale ? "text-amber-600 dark:text-amber-400" : undefined}>{freshness?.text}</span>
        {freshness?.coverage && <InfoTip text={freshness.coverage} />}
        {refresh.canRefresh && <button type="button" disabled={refresh.isRefreshing} onClick={refresh.handleRefresh}
            className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-60">
            <RotateCw className={cn("size-3", refresh.isRefreshing && "animate-spin")} />갱신
        </button>}
        {refresh.message && <span>{refresh.message}</span>}
    </span>;
}
