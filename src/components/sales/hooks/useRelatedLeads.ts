import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { LeadRecord } from "@/components/leads/types";

/** 연관 리드 — 같은 기업 + 직접 묶은 리드 */
export function useRelatedLeads(recordId: number | null) {
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: LeadRecord[] }>(
        recordId ? `/api/records/${recordId}/related` : null,
        defaultFetcher,
    );
    return { related: data?.data ?? [], isLoading, mutate };
}
