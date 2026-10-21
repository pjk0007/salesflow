import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StatsQuery } from "../types";
import { useEmailStatsKpi } from "../hooks/useEmailStatsKpi";
import { useEmailStatsRefresh } from "../hooks/useEmailStatsRefresh";
export function StatsFreshness({ query }: { query: StatsQuery }) {
    const { freshness } = useEmailStatsKpi(query);
    const refresh = useEmailStatsRefresh();
    return <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
            <span className={freshness?.isStale ? "text-amber-600 dark:text-amber-400" : undefined}>{freshness?.text}</span>
            {refresh.canRefresh && <Button size="sm" variant="outline" disabled={refresh.isRefreshing} onClick={refresh.handleRefresh}>
                {refresh.isRefreshing && <Loader2 className="size-3 animate-spin" />}지금 갱신
            </Button>}
        </div>
        <p>{freshness?.coverage}</p><p>{refresh.message}</p>
    </div>;
}
