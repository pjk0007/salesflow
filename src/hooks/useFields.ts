import useSWR from "swr";
import type { ApiResponse, FieldDefinition } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";


export function useFields(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<FieldDefinition[]>>(
        workspaceId ? `/api/workspaces/${workspaceId}/fields` : null,
        defaultFetcher
    );

    return {
        fields: data?.data ?? [],
        isLoading,
        error,
        mutate,
    };
}
