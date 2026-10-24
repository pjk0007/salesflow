import useSWR from "swr";
import type { ApiResponse, CreateWorkspaceInput } from "@/types";
import { blockingError, defaultFetcher } from "@/lib/swr-fetcher";

interface WorkspaceItem {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    defaultFieldTypeId: number | null;
    hiddenAt: string | null;
}


export function useWorkspaces() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<WorkspaceItem[]>>(
        "/api/workspaces",
        defaultFetcher
    );

    const createWorkspace = async (input: CreateWorkspaceInput) => {
        const res = await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteWorkspace = async (id: number) => {
        const res = await fetch(`/api/workspaces/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const allWorkspaces = data?.data ?? [];

    return {
        // 선택 목록용 — 숨긴 워크스페이스는 뺀다. 설정 화면처럼 전부 다뤄야 하면 allWorkspaces
        workspaces: allWorkspaces.filter((w) => !w.hiddenAt),
        allWorkspaces,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
        createWorkspace,
        deleteWorkspace,
    };
}
