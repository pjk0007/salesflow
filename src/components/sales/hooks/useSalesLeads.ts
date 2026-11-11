import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { LeadRecord } from "@/components/leads/types";

export const SALES_LEADS_KEY = "/api/sales/leads?";

/** 영업 리드 목록 — workspaceId 없으면 전체 사업부 */
export function useSalesLeads(p: { enabled: boolean; workspaceId: number | null; mine: boolean; search: string; page: number }) {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: "50" });
    if (p.workspaceId) qs.set("workspaceId", String(p.workspaceId));
    if (p.mine) qs.set("mine", "1");
    if (p.search) qs.set("search", p.search);
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: LeadRecord[]; total: number; totalPages: number }>(
        p.enabled ? `${SALES_LEADS_KEY}${qs.toString()}` : null,
        defaultFetcher,
    );
    return { records: data?.data ?? [], total: data?.total ?? 0, totalPages: data?.totalPages ?? 0, isLoading, mutate };
}
