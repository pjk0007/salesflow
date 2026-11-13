"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompareKpi, type CompareGroup } from "../hooks/useCompareStats";
import { CompareCards } from "./CompareCards";

/** 메일 묶음·기간 비교 지표 카드 */
export function CompareKpiGrid({ groups }: { groups: CompareGroup[] }) {
    const stats = useCompareKpi(groups);
    if (stats.error)
        return (
            <div role="alert" className="flex items-center gap-3 text-sm">
                이메일 통계를 불러오지 못했습니다.{" "}
                <Button variant="outline" onClick={stats.retry}>
                    다시 불러오기
                </Button>
            </div>
        );
    if (stats.isLoading || stats.cards.length === 0)
        return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 rounded-lg" />
                ))}
            </div>
        );
    return <CompareCards cards={stats.cards} />;
}
