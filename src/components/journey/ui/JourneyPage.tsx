"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useJourney } from "../hooks/useJourney";
import { JourneyHeader } from "./JourneyHeader";
import { JourneySummaryBar } from "./JourneySummaryBar";
import { AttributionCard } from "./AttributionCard";
import { NextActionCard } from "./NextActionCard";
import { ChannelSwimlane } from "./ChannelSwimlane";
import { JourneyTimeline } from "./JourneyTimeline";
import { JourneyEngagement } from "./JourneyEngagement";
import { JourneyEventDetail } from "./JourneyEventDetail";
import { ChannelFilter } from "./ChannelFilter";
import type { JourneyEvent } from "../types";

export function JourneyPage({ recordId }: { recordId: number }) {
    const router = useRouter();
    const [channels, setChannels] = useState<string[]>([]);
    // 필터는 클라이언트에서 처리 — 서버 재요청 없이 즉시 (깜빡임 방지)
    const { journey, isLoading } = useJourney(recordId);
    const [selected, setSelected] = useState<JourneyEvent | null>(null);
    const [hovered, setHovered] = useState<JourneyEvent | null>(null);

    // 채널(source) 필터: 빈 배열이면 전체
    const filteredEvents = journey
        ? (channels.length === 0
            ? journey.events
            : journey.events.filter((e) => channels.includes(e.source)))
        : [];

    // hover 중이면 그 이벤트, 아니면 클릭 선택, 둘 다 없으면 첫 이벤트(기본)
    const preview = hovered ?? selected ?? filteredEvents[0] ?? null;

    return (
        <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    뒤로
                </button>
                <h1 className="text-base font-semibold">고객 여정</h1>
            </div>

            {isLoading && (
                <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
                    불러오는 중...
                </div>
            )}

            {!isLoading && journey && (
                <>
                    {/* 헤더 + 지표 (전폭) */}
                    <JourneyHeader summary={journey.summary} />
                    <JourneySummaryBar summary={journey.summary} />

                    {/* 채널 가로 타임라인 (전폭 — 넓을수록 좋음) */}
                    <ChannelSwimlane events={filteredEvents} onSelect={setSelected} onHover={setHovered} />

                    {/* 2단: 좌(메인) 타임라인 + 우(사이드) 분석 */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
                        {/* 좌: 선택 이벤트 + 세로 타임라인 */}
                        <div className="space-y-4 min-w-0">
                            {/* min-height 고정 — hover로 카드 내용 바뀌어도 높이 불변(스크롤/떨림 방지) */}
                            <div className="min-h-[180px]">
                                {preview && <JourneyEventDetail event={preview} />}
                            </div>
                            <ChannelFilter selected={channels} onChange={setChannels} />
                            <JourneyTimeline events={filteredEvents} onSelect={setSelected} />
                        </div>

                        {/* 우: 어트리뷰션 / 액션제안 / 관여도 */}
                        <div className="space-y-4">
                            <AttributionCard attribution={journey.attribution} />
                            <NextActionCard actions={journey.nextActions} />
                            {journey.summary.dailyActivity.length > 0 && (
                                <div className="rounded-lg border bg-card p-4">
                                    <JourneyEngagement daily={journey.summary.dailyActivity} />
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
