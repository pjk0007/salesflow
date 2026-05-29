"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { EngagementResponse } from "../types/engagement";

export function useEngagementAnalytics(args: {
    siteId: number | null;
    from: string;
    to: string;
    device?: string | null;
    channel?: string | null;
    channelMode?: "all" | "paid" | "organic";
    page?: string | null;
}) {
    const key = args.siteId
        ? `/api/tracker/analytics/engagement?` + new URLSearchParams({
            siteId: String(args.siteId),
            from: args.from,
            to: args.to,
            ...(args.device ? { device: args.device } : {}),
            ...(args.channel ? { channel: args.channel } : {}),
            ...(args.channelMode && args.channelMode !== "all" ? { channelMode: args.channelMode } : {}),
            ...(args.page ? { page: args.page } : {}),
        }).toString()
        : null;
    const { data, isLoading, error } = useSWR<EngagementResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : null,
        isLoading,
        error: data && !data.success ? data.error : (error?.message ?? null),
    };
}
