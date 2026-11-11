import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { resolveLeadStatusSettings, type LeadStatusSetting } from "@/lib/leads/statuses";

/** 워크스페이스의 리드 대응상태 (설정이 없으면 기본 순서) */
export function useLeadStatuses(workspaceId: number | null, fieldOptions: string[] = []) {
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: LeadStatusSetting[] | null }>(
        workspaceId ? `/api/workspaces/${workspaceId}/lead-statuses` : null,
        defaultFetcher,
    );
    const settings = resolveLeadStatusSettings(data?.data, fieldOptions);
    return {
        settings,
        enabled: settings.filter((s) => s.enabled).map((s) => s.label),
        isLoading,
        mutate,
    };
}
