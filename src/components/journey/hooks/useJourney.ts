import useSWR from "swr";
import type { ApiResponse } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { JourneyData } from "../types";

/** record 여정 또는 익명 방문자 여정 — 응답 shape 동일, 소스만 다름 */
export type JourneySource = { recordId: number } | { visitorId: number };

function journeyUrl(source: JourneySource | null, qs: string): string | null {
    if (!source) return null;
    if ("recordId" in source) return `/api/records/${source.recordId}/journey${qs}`;
    return `/api/tracker/visitors/${source.visitorId}/journey${qs}`;
}

export function useJourney(source: JourneySource | null, channels?: string[]) {
    const qs = channels && channels.length
        ? "?" + channels.map((c) => `channel=${encodeURIComponent(c)}`).join("&")
        : "";
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<JourneyData>>(
        journeyUrl(source, qs),
        defaultFetcher
    );

    return {
        journey: data?.data ?? null,
        isLoading,
        error,
        mutate,
    };
}
