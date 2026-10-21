import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsQuery } from "../types";
import { useEmailStatsTrend } from "../hooks/useEmailStatsTrend";
import { TrendChart } from "./TrendChart";
export function TrendPanel({ query }: { query: StatsQuery }) {
    const stats = useEmailStatsTrend(query);
    return <Card>
        <CardHeader><CardTitle className="text-base">일별 추세</CardTitle>
            <Tabs value={stats.tab} onValueChange={stats.handleTab}><TabsList><TabsTrigger value="response">반응</TabsTrigger><TabsTrigger value="loss">이탈</TabsTrigger></TabsList></Tabs>
        </CardHeader>
        <CardContent>
            {stats.error ? <div role="alert">이메일 통계를 불러오지 못했습니다. <Button variant="outline" onClick={stats.handleRetry}>다시 불러오기</Button></div>
                : stats.isLoading ? <Skeleton className="h-80" aria-label="추세 로딩 중" />
                    : stats.model && <TrendChart model={stats.model} tab={stats.tab} />}
        </CardContent>
    </Card>;
}
