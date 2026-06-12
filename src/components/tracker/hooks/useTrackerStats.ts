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

export function useTrackerStats(
    siteId: number | null,
    filters?: { pagePath?: string; channel?: string },
) {
    const key = siteId
        ? `/api/tracker/visitors/stats?${new URLSearchParams({
              siteId: String(siteId),
              ...(filters?.pagePath ? { pagePath: filters.pagePath } : {}),
              ...(filters?.channel ? { channel: filters.channel } : {}),
          }).toString()}`
        : null;

    const { data, isLoading, mutate } = useSWR<Response>(key, defaultFetcher);

    return {
        stats: data?.success ? data.data : null,
        isLoading,
        mutate,
    };
}
