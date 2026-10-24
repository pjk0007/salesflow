"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FunnelOptionsResponse } from "../types/funnel";

export function useFunnelOptions(siteId: number | null) {
    const key = siteId ? `/api/tracker/sites/${siteId}/funnel-options` : null;
    const { data, isLoading, error , mutate: retryQuery0 } = useSWR<FunnelOptionsResponse>(key, defaultFetcher);
    return {
        mutate: retryQuery0,
        options: data?.success ? data.data : null,
        isLoading,
        error: data && !data.success ? data.error : (error?.message ?? null),
    };
}
