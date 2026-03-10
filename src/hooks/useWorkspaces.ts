import useSWR from "swr";
import type { ApiResponse, CreateWorkspaceInput } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface WorkspaceItem {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
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

    return {
        workspaces: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createWorkspace,
        deleteWorkspace,
    };
}
