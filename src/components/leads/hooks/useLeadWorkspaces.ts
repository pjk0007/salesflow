import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { sortByDisplayNo } from "@/lib/workspace-label";

export interface LeadWorkspace {
    id: number;
    name: string;
    icon: string | null;
    displayNo?: string | null;
    leads: number;
    newLeads: number;
}

/** 리드 관리 파티션이 있는 워크스페이스 (상단 탭) */
export function useLeadWorkspaces() {
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: LeadWorkspace[] }>("/api/leads/workspaces", defaultFetcher);
    return { workspaces: sortByDisplayNo(data?.data ?? []), isLoading, mutate };
}
