"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { OverviewResponse } from "../types/overview";

export function useTrackerOverview(args: { siteId: number | null; from: string; to: string }) {
    const key = args.siteId
        ? `/api/tracker/analytics/overview?siteId=${args.siteId}&from=${args.from}&to=${args.to}`
        : null;
    const { data, isLoading, error, mutate } = useSWR<OverviewResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : null,
        isLoading,
        error: data && !data.success ? data.error : error?.message ?? null,
        mutate,
    };
}
