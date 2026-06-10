"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import type { VisitorDetailResponse } from "../types/visitor-detail";
import { VisitorInfoCard } from "./visitor-detail/VisitorInfoCard";
import { SectionDwellCard, ClickTopCard, TopPagesCard } from "./visitor-detail/VisitorEngagementCards";
import { VisitorHourlyChart } from "./visitor-detail/VisitorHourlyChart";
import { VisitorChannelCard } from "./visitor-detail/VisitorChannelCard";
import { VisitorActivityChart } from "./visitor-detail/VisitorActivityChart";
import { VisitorSessionTimeline } from "./visitor-detail/VisitorSessionTimeline";

export function VisitorDetailPage({ visitorPk }: { visitorPk: number }) {
    const { data, isLoading } = useSWR<VisitorDetailResponse>(
        `/api/tracker/visitors/${visitorPk}`,
        defaultFetcher,
    );

    if (isLoading) {
        return <Skeleton className="h-96 w-full" />;
    }

    if (!data?.success) {
        return <p className="text-sm text-muted-foreground">방문자를 찾을 수 없습니다.</p>;
    }

    const { visitor, summary, sessions, events, engagement, dailyActivity, hourlyActivity, aliases } =
        data.data;
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);

    return (
        <div className="space-y-6">
            <VisitorInfoCard visitor={visitor} summary={summary} totalDuration={totalDuration} />

            {/* 관심도 — 섹션/클릭은 데이터 있을 때만, 나머지는 항상 */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                <TopPagesCard pages={engagement.pages} />
                <VisitorHourlyChart hourly={hourlyActivity} />
                <VisitorChannelCard sessions={sessions} />
                <SectionDwellCard sections={engagement.sections} />
                <ClickTopCard clicks={engagement.clicks} />
            </div>

            <VisitorActivityChart daily={dailyActivity} />
            <VisitorSessionTimeline sessions={sessions} events={events} aliases={aliases} />
        </div>
    );
}
