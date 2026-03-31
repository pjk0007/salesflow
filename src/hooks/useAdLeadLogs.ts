import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdLeadLogInfo, AdLeadLogStatus } from "@/types";

interface ListResponse {
    success: boolean;
    data: AdLeadLogInfo[];
}

interface StatsResponse {
    success: boolean;
    data: {
        total: number;
        success: number;
        failed: number;
        duplicate: number;
        skipped: number;
    };
}

export function useAdLeadLogs(integrationId?: number, status?: AdLeadLogStatus) {
    const params = new URLSearchParams();
    if (integrationId) params.set("integrationId", String(integrationId));
    if (status) params.set("status", status);
    const query = params.toString();
    const url = `/api/ad-lead-logs${query ? `?${query}` : ""}`;

    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        url,
        defaultFetcher
    );

    return {
        logs: data?.data || [],
        error,
        isLoading,
        mutate,
    };
}

export function useAdLeadLogStats(integrationId?: number) {
    const url = integrationId
        ? `/api/ad-lead-logs/stats?integrationId=${integrationId}`
        : null;

    const { data, error, isLoading } = useSWR<StatsResponse>(
        url,
        defaultFetcher
    );

    return {
        stats: data?.data || null,
        error,
        isLoading,
    };
}
