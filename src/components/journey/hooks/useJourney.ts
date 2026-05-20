import useSWR from "swr";
import type { ApiResponse } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { JourneyData } from "../types";

export function useJourney(recordId: number | null, channels?: string[]) {
    const qs = channels && channels.length
        ? "?" + channels.map((c) => `channel=${encodeURIComponent(c)}`).join("&")
        : "";
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<JourneyData>>(
        recordId ? `/api/records/${recordId}/journey${qs}` : null,
        defaultFetcher
    );

    return {
        journey: data?.data ?? null,
        isLoading,
        error,
        mutate,
    };
}
