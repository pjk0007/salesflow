import useSWR from "swr";
import type { Dashboard } from "@/lib/db";
import { defaultFetcher } from "@/lib/swr-fetcher";


export function useDashboards(workspaceId?: number | null) {
    const key = workspaceId
        ? `/api/dashboards?workspaceId=${workspaceId}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<{
        success: boolean;
        data: Dashboard[];
    }>(key, defaultFetcher);

    const createDashboard = async (input: {
        name: string;
        workspaceId: number;
        description?: string;
    }) => {
        const res = await fetch("/api/dashboards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateDashboard = async (id: number, input: Record<string, unknown>) => {
        const res = await fetch(`/api/dashboards/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteDashboard = async (id: number) => {
        const res = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        dashboards: data?.data ?? [],
        isLoading,
        error,
        createDashboard,
        updateDashboard,
        deleteDashboard,
        mutate,
    };
}
