import useSWR from "swr";
import type { ApiResponse, WorkspaceDetail, UpdateWorkspaceInput } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useWorkspaceSettings(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<WorkspaceDetail>>(
        workspaceId ? `/api/workspaces/${workspaceId}/settings` : null,
        fetcher
    );

    const updateWorkspace = async (input: UpdateWorkspaceInput) => {
        if (!workspaceId) return { success: false, error: "워크스페이스를 선택해주세요." };
        const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        workspace: data?.data ?? null,
        isLoading,
        error,
        updateWorkspace,
    };
}
