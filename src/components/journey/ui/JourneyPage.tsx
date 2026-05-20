"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useJourney } from "../hooks/useJourney";
import { JourneySummaryBar } from "./JourneySummaryBar";
import { JourneyTimeline } from "./JourneyTimeline";
import { JourneyEngagement } from "./JourneyEngagement";
import { JourneyEventDetail } from "./JourneyEventDetail";
import { ChannelFilter } from "./ChannelFilter";
import type { JourneyEvent } from "../types";

export function JourneyPage({ recordId }: { recordId: number }) {
    const router = useRouter();
    const [channels, setChannels] = useState<string[]>([]);
    const { journey, isLoading } = useJourney(recordId, channels);
    const [selected, setSelected] = useState<JourneyEvent | null>(null);

    return (
        <div className="mx-auto max-w-3xl p-4 space-y-4">
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
                    <JourneySummaryBar summary={journey.summary} />

                    {journey.summary.dailyActivity.length > 0 && (
                        <div className="rounded-lg border bg-card p-4">
                            <JourneyEngagement daily={journey.summary.dailyActivity} />
                        </div>
                    )}

                    <ChannelFilter selected={channels} onChange={setChannels} />

                    {selected && (
                        <JourneyEventDetail event={selected} onClose={() => setSelected(null)} />
                    )}

                    <JourneyTimeline events={journey.events} onSelect={setSelected} />
                </>
            )}
        </div>
    );
}
