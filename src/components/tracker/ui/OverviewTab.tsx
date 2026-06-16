"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTrackerOverview } from "../hooks/useTrackerOverview";
import { useFunnelAnalytics } from "../hooks/useFunnelAnalytics";
import { useTrackerFunnels } from "../hooks/useTrackerFunnels";
import { KpiCards } from "./widgets/KpiCards";
import { DailyPageviewChart } from "./widgets/DailyPageviewChart";
import { DailyConversions } from "./widgets/DailyConversions";
import { ChannelConversion } from "./widgets/ChannelConversion";
import { FunnelPreview } from "./widgets/FunnelPreview";
import { RangeSelector, presetRange } from "./widgets/RangeSelector";
import { SegmentFilter } from "./widgets/SegmentFilter";
import { Skeleton } from "@/components/ui/skeleton";
import type { Range, SegmentFilters } from "../types/overview";

function rangeFromSearchParams(sp: URLSearchParams): Range {
    const from = sp.get("from");
    const to = sp.get("to");
    if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return { preset: "custom", from, to };
    }
    return presetRange("7d");
}

/**
 * 개요(요약) 탭 — 핵심 KPI + 일별 차트 + 최근 활성 방문자.
 * 마케팅 분석은 MarketingTab으로 분리됨.
 */
export function OverviewTab({ siteId }: { siteId: number | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const sp = useSearchParams();

    const [range, setRange] = useState<Range>(() => rangeFromSearchParams(new URLSearchParams(sp.toString())));
    const [filters, setFilters] = useState<SegmentFilters>({ device: null, channel: null, channelMode: "all" });

    useEffect(() => {
        const next = new URLSearchParams(sp.toString());
        next.set("from", range.from);
        next.set("to", range.to);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to]);

    const { data, isLoading, error } = useTrackerOverview({
        siteId,
        from: range.from,
        to: range.to,
        device: filters.device,
        channel: filters.channel,
        channelMode: filters.channelMode,
    });

    // 사용자정의 퍼널 분석 — 메인 퍼널 기준 단계별 visitor 수 (코호트 분석)
    const { data: funnelData } = useFunnelAnalytics({
        siteId,
        from: range.from,
        to: range.to,
        device: filters.device,
        channel: filters.channel,
        channelMode: filters.channelMode,
    });
    // 사이트에 퍼널 정의 있는지 확인 (없으면 안내 메시지 표시)
    const { funnels } = useTrackerFunnels(siteId);
    const hasFunnelDefined = funnels.length > 0;

    const isFilterActive = useMemo(
        () => filters.device !== null || filters.channel !== null || filters.channelMode !== "all",
        [filters],
    );

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
                    <FunnelPreview data={funnelData} showSetupHint={!hasFunnelDefined} />
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <DailyPageviewChart data={data.dailyPageviews} />
                        <DailyConversions
                            data={data.dailyConversions}
                            conversionLabel={data.funnel.conversionStageLabel}
                        />
                    </div>
                    <ChannelConversion items={data.channelConversions} />
                </>
            )}
        </div>
    );
}

/** 기간 + 필터 컨트롤바 — Overview/Marketing 탭에서 동일하게 사용 */
export function ControlBar({
    range,
    onRangeChange,
    filters,
    onFiltersChange,
    isFilterActive,
}: {
    range: Range;
    onRangeChange: (r: Range) => void;
    filters: SegmentFilters;
    onFiltersChange: (f: SegmentFilters) => void;
    isFilterActive: boolean;
}) {
    return (
        <div className="space-y-2">
            {/* 1줄: 기간 표시 + 기간 선택기 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">{range.from} ~ {range.to}</p>
                    {isFilterActive && (
                        <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground">
                            {[
                                filters.device,
                                filters.channel,
                                filters.channelMode !== "all"
                                    ? filters.channelMode === "paid" ? "광고만" : "자연만"
                                    : null,
                            ].filter(Boolean).join(" · ")}
                        </span>
                    )}
                </div>
                <RangeSelector value={range} onChange={onRangeChange} />
            </div>

            {/* 2줄: 세그먼트 필터 (디바이스/채널/광고-자연/해제) */}
            <div className="flex flex-wrap items-center gap-2">
                <SegmentFilter value={filters} onChange={onFiltersChange} />
            </div>
        </div>
    );
}
