"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

type Stats = {
    totalVisitors: number;
    identifiedVisitors: number;
    totalPageviews: number;
};

type Response =
    | { success: true; data: Stats }
    | { success: false; error: string };

export function useTrackerStats(siteId: number | null) {
    const { data, isLoading, mutate } = useSWR<Response>(
        siteId ? `/api/tracker/visitors/stats?siteId=${siteId}` : null,
        defaultFetcher,
    );

    return {
        stats: data?.success ? data.data : null,
        isLoading,
        mutate,
    };
}
