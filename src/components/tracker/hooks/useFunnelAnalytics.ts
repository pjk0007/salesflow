"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FunnelAnalyticsResponse } from "../types/funnel";

export function useFunnelAnalytics(args: {
    siteId: number | null;
    funnelId?: number | null;
    from: string;
    to: string;
    device?: string | null;
    channel?: string | null;
    channelMode?: "all" | "paid" | "organic";
}) {
    const key = args.siteId
        ? `/api/tracker/analytics/funnel?` + new URLSearchParams({
            siteId: String(args.siteId),
            from: args.from,
            to: args.to,
            ...(args.funnelId ? { funnelId: String(args.funnelId) } : {}),
            ...(args.device ? { device: args.device } : {}),
            ...(args.channel ? { channel: args.channel } : {}),
            ...(args.channelMode && args.channelMode !== "all" ? { channelMode: args.channelMode } : {}),
        }).toString()
        : null;
    const { data, isLoading, error } = useSWR<FunnelAnalyticsResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : null,
        isLoading,
        error: data && !data.success ? data.error : (error?.message ?? null),
    };
}
