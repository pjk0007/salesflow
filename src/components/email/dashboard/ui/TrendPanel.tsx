import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/leads/ui/stats/Card";
import type { StatsQuery } from "../types";
import { useEmailStatsTrend } from "../hooks/useEmailStatsTrend";
import { TrendChart } from "./TrendChart";
export function TrendPanel({ query }: { query: StatsQuery }) {
    const stats = useEmailStatsTrend(query);
    return <StatCard
        title="일별 추세"
        info={"막대는 하루 발송(접수) 수, 선은 비율입니다.\n반응: 오픈율·클릭률·회신율\n이탈: 반송률·수신거부율"}
        action={<Tabs value={stats.tab} onValueChange={stats.handleTab}><TabsList><TabsTrigger value="response">반응</TabsTrigger><TabsTrigger value="loss">이탈</TabsTrigger></TabsList></Tabs>}
    >
        {stats.error ? <div role="alert" className="flex items-center gap-3 text-sm">이메일 통계를 불러오지 못했습니다. <Button variant="outline" onClick={stats.handleRetry}>다시 불러오기</Button></div>
            : stats.isLoading ? <Skeleton className="h-80" aria-label="추세 로딩 중" />
                : stats.model && <TrendChart model={stats.model} tab={stats.tab} />}
    </StatCard>;
}
