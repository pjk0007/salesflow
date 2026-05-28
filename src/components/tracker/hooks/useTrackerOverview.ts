"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { OverviewResponse } from "../types/overview";

export function useTrackerOverview(args: {
    siteId: number | null;
    from: string;
    to: string;
    device?: string | null;
    channel?: string | null;
    channelMode?: "all" | "paid" | "organic";
}) {
    const key = args.siteId
        ? `/api/tracker/analytics/overview?` + new URLSearchParams({
            siteId: String(args.siteId),
            from: args.from,
            to: args.to,
            ...(args.device ? { device: args.device } : {}),
            ...(args.channel ? { channel: args.channel } : {}),
            ...(args.channelMode && args.channelMode !== "all" ? { channelMode: args.channelMode } : {}),
        }).toString()
        : null;
    const { data, isLoading, error, mutate } = useSWR<OverviewResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : null,
        isLoading,
        error: data && !data.success ? data.error : error?.message ?? null,
        mutate,
    };
}
