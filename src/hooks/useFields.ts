import useSWR from "swr";
import type { ApiResponse, FieldDefinition } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useFields(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<FieldDefinition[]>>(
        workspaceId ? `/api/workspaces/${workspaceId}/fields` : null,
        fetcher
    );

    return {
        fields: data?.data ?? [],
        isLoading,
        error,
        mutate,
    };
}
