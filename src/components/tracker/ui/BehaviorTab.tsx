"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { EventFunnelCard } from "./widgets/EventFunnelCard";
import { EngagementCard } from "./widgets/EngagementCard";
import { presetRange } from "./widgets/RangeSelector";
import { ControlBar } from "./OverviewTab";
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
 * 행동 탭 — 사이트 안에서 방문자가 한 행동 분석.
 * 행동 퍼널(폼/단계 이탈)과 페이지 인게이지먼트(섹션 시인·클릭).
 * 마케팅 탭(유입/채널/광고)과 보는 질문이 달라 분리.
 * 기간/필터 컨트롤은 다른 탭과 동일 (URL ?from&to 공유).
 */
export function BehaviorTab({ siteId }: { siteId: number | null }) {
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

    const isFilterActive = useMemo(() => filters.device !== null || filters.channel !== null, [filters]);

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
            <EventFunnelCard siteId={siteId} range={range} filters={filters} />
            <EngagementCard siteId={siteId} range={range} filters={filters} />
        </div>
    );
}
