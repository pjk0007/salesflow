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

// 6칸 그리드에서 줄을 항상 꽉 채우는 스팬 — 남는 카드 1장이면 전폭, 2장이면 반반
function cardSpan(i: number, n: number): string {
    const isLast = i === n - 1;
    const rem3 = n % 3;
    let xl = "xl:col-span-2";
    if (rem3 === 1 && isLast) xl = "xl:col-span-6";
    else if (rem3 === 2 && i >= n - 2) xl = "xl:col-span-3";
    // md(2칸)에서는 홀수 개일 때 마지막 카드만 전폭
    const md = n % 2 === 1 && isLast ? "md:col-span-2" : "md:col-span-1";
    return `${md} ${xl}`;
}

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

    // 관심도 카드 — 데이터 있는 것만 모아서 빈칸 없이 배치
    const cards: Array<(className: string) => React.ReactNode> = [];
    if (engagement.pages.length > 0) {
        cards.push((cls) => <TopPagesCard key="pages" pages={engagement.pages} className={cls} />);
    }
    if (hourlyActivity.length > 0) {
        cards.push((cls) => <VisitorHourlyChart key="hourly" hourly={hourlyActivity} className={cls} />);
    }
    if (sessions.length > 0) {
        cards.push((cls) => <VisitorChannelCard key="channel" sessions={sessions} className={cls} />);
    }
    if (engagement.sections.length > 0) {
        cards.push((cls) => <SectionDwellCard key="sections" sections={engagement.sections} className={cls} />);
    }
    if (engagement.clicks.length > 0) {
        cards.push((cls) => <ClickTopCard key="clicks" clicks={engagement.clicks} className={cls} />);
    }

    return (
        <div className="space-y-6">
            <VisitorInfoCard visitor={visitor} summary={summary} totalDuration={totalDuration} />

            {cards.length > 0 && (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-6">
                    {cards.map((render, i) => render(cardSpan(i, cards.length)))}
                </div>
            )}

            <VisitorActivityChart daily={dailyActivity} />
            <VisitorSessionTimeline sessions={sessions} events={events} aliases={aliases} />
        </div>
    );
}
