"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTrackerOverview } from "../hooks/useTrackerOverview";
import { PopularPages } from "./widgets/PopularPages";
import { ExitPages } from "./widgets/ExitPages";
import { InflowChannels } from "./widgets/InflowChannels";
import { AdContentTop } from "./widgets/AdContentTop";
import { AdPerformanceCard } from "./widgets/AdPerformanceCard";
import { DeviceBreakdown } from "./widgets/DeviceBreakdown";
import { rangeFromSearchParams, rangeSearchParams } from "../utils/range";
import { ControlBar } from "./OverviewTab";
import { Skeleton } from "@/components/ui/skeleton";
import type { Range, SegmentFilters } from "../types/overview";

/**
 * 마케팅 탭 — 인기/이탈 페이지, 유입 채널, 광고 소재, 디바이스 분포.
 * Overview와 같은 기간/필터 컨트롤 공유 (URL ?from&to 동일).
 */
export function MarketingTab({ siteId }: { siteId: number | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const sp = useSearchParams();

    const [range, setRange] = useState<Range>(() => rangeFromSearchParams(new URLSearchParams(sp.toString())));
    const [filters, setFilters] = useState<SegmentFilters>({ device: null, channel: null, channelMode: "all" });

    useEffect(() => {
        const next = rangeSearchParams(range, new URLSearchParams(sp.toString()));
        if (next.toString() !== sp.toString()) {
            router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.preset, range.from, range.to]);

    const { data, isLoading, error } = useTrackerOverview({
        siteId,
        from: range.from,
        to: range.to,
        device: filters.device,
        channel: filters.channel,
        channelMode: filters.channelMode,
    });

    const isFilterActive = useMemo(() => filters.device !== null || filters.channel !== null || filters.channelMode !== "all", [filters]);

    if (!siteId) return <p className="text-sm text-muted-foreground">트래커가 설정되지 않았습니다.</p>;

    return (
        <div className="space-y-4">
            <ControlBar
                range={range}
                onRangeChange={setRange}
                filters={filters}
                onFiltersChange={setFilters}
                isFilterActive={isFilterActive}
            />

            {isLoading && !data && (
                <div className="space-y-3">
                    <Skeleton className="h-64 w-full" />
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
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <PopularPages pages={data.popularPages} />
                        <ExitPages pages={data.exitPages} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <InflowChannels channels={data.inflowChannels} />
                        <AdContentTop items={data.adContents} />
                    </div>
                    <AdPerformanceCard siteId={siteId} range={range} filters={filters} />
                    <DeviceBreakdown devices={data.devices} />
                </>
            )}
        </div>
    );
}
