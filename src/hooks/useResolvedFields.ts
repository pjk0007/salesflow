import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FieldDefinition } from "@/types";

interface ResolvedFieldsResponse {
    success: boolean;
    data?: FieldDefinition[];
}

export function useResolvedFields(partitionId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ResolvedFieldsResponse>(
        partitionId ? `/api/partitions/${partitionId}/resolved-fields` : null,
        defaultFetcher
    );

    return {
        fields: data?.data ?? [],
        isLoading,
        error,
        mutate,
    };
}
