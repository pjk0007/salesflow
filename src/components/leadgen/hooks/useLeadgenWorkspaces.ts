import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { useWorkspaces } from "@/hooks/useWorkspaces";

/** 메일을 보낸 적 있는 사업부 — 리드젠통계 기본 탭 */
export function useLeadgenWorkspaces() {
    const all = useWorkspaces();
    const { data, isLoading } = useSWR<{ success: boolean; data: number[] }>("/api/analytics/email-stats/workspaces", defaultFetcher);
    const sent = new Set(data?.data ?? []);
    return {
        items: all.workspaces.filter((w) => sent.has(w.id)).map((w) => ({ id: w.id, name: w.name, displayNo: w.displayNo ?? null })),
        isLoading: all.isLoading || isLoading,
    };
}
