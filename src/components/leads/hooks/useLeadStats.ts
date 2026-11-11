import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { LeadStats } from "@/lib/leads/stats";

/** period: { days } 빠른 기간 또는 { from, to } 날짜(YYYY-MM-DD), 둘 다 없으면 전체 */
export function useLeadStats(workspaceId: number | null, period: { days?: number | null; from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspaceId", String(workspaceId));
    if (period.from) qs.set("from", period.from);
    if (period.to) qs.set("to", period.to);
    if (!period.from && !period.to && period.days) qs.set("days", String(period.days));
    const key = workspaceId ? `/api/leads/stats?${qs.toString()}` : null;
    const { data, isLoading, error } = useSWR<{ success: boolean; data: LeadStats }>(key, defaultFetcher);
    return { stats: data?.data ?? null, isLoading, error };
}
