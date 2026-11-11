import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { LeadStats } from "@/lib/leads/stats";

export function useLeadStats(workspaceId: number | null, days: number | null) {
    const key = workspaceId ? `/api/leads/stats?workspaceId=${workspaceId}${days ? `&days=${days}` : ""}` : null;
    const { data, isLoading, error } = useSWR<{ success: boolean; data: LeadStats }>(key, defaultFetcher);
    return { stats: data?.data ?? null, isLoading, error };
}
