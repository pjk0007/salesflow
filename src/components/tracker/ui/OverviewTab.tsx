"use client";

import { useState } from "react";
import { useTrackerOverview } from "../hooks/useTrackerOverview";
import { KpiCards } from "./widgets/KpiCards";
import { DailyPageviewChart } from "./widgets/DailyPageviewChart";
import { PopularPages } from "./widgets/PopularPages";
import { RecentSessions } from "./widgets/RecentSessions";
import { InflowChannels } from "./widgets/InflowChannels";
import { DeviceBreakdown } from "./widgets/DeviceBreakdown";
import { RangeSelector, presetRange } from "./widgets/RangeSelector";
import { Skeleton } from "@/components/ui/skeleton";
import type { Range } from "../types/overview";

export function OverviewTab({ siteId }: { siteId: number | null }) {
    const [range, setRange] = useState<Range>(() => presetRange("30d"));
    const { data, isLoading, error } = useTrackerOverview({ siteId, from: range.from, to: range.to });

    if (!siteId) {
        return <p className="text-sm text-muted-foreground">트래커가 설정되지 않았습니다.</p>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{range.from} ~ {range.to}</p>
                <RangeSelector value={range} onChange={setRange} />
            </div>

            {isLoading && !data && (
                <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            )}

            {error && !data && (
                <div className="rounded-lg border bg-card p-6 text-center text-sm text-rose-600">
                    데이터를 불러오지 못했습니다.
                </div>
            )}

            {data && (
                <>
                    <KpiCards kpi={data.kpi} />
                    <DailyPageviewChart data={data.dailyPageviews} />
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <PopularPages pages={data.popularPages} />
                        <InflowChannels channels={data.inflowChannels} />
                    </div>
                    <RecentSessions sessions={data.recentSessions} />
                    <DeviceBreakdown devices={data.devices} />
                </>
            )}
        </div>
    );
}
