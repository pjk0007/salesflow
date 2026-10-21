import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsQuery } from "../types";
import { useEmailStatsKpi } from "../hooks/useEmailStatsKpi";
import { KpiCard } from "./KpiCard";
export function KpiGrid({ query }: { query: StatsQuery }) {
    const stats = useEmailStatsKpi(query);
    if (stats.error) return <div role="alert">이메일 통계를 불러오지 못했습니다. <Button variant="outline" onClick={stats.handleRetry}>다시 불러오기</Button></div>;
    if (stats.isLoading) return <Skeleton className="h-64 w-full" aria-label="핵심 지표 로딩 중" />;
    return <section className="space-y-3" aria-label="이메일 핵심 지표">
        {stats.freshness?.notice && <p className="text-sm text-amber-600 dark:text-amber-400">{stats.freshness.notice}</p>}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{stats.cards.map(card => <KpiCard key={card.key} card={card} />)}</div>
    </section>;
}
