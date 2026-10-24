"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdPerformanceResponse } from "../types/ad-performance";

export function useAdPerformance(args: {
    siteId: number | null;
    from: string;
    to: string;
    funnelId?: number | null;
}) {
    const key = args.siteId
        ? `/api/tracker/analytics/ad-performance?` + new URLSearchParams({
            siteId: String(args.siteId),
            from: args.from,
            to: args.to,
            ...(args.funnelId ? { funnelId: String(args.funnelId) } : {}),
        }).toString()
        : null;
    const { data, error, isLoading, mutate } = useSWR<AdPerformanceResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : null,
        isLoading,
        mutate,
        error: data && !data.success ? data.error : (error?.message ?? null),
    };
}
