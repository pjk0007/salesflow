import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FilterCondition } from "@/types";

interface UseGroupCountsParams {
    partitionId: number | null;
    groupBy: string | null;
    search?: string;
    distributionOrder?: number;
    filters?: FilterCondition[];
}

interface GroupCountsResponse {
    success: boolean;
    groupBy: string;
    counts: Record<string, number>;
    uncategorized: number;
    total: number;
}

function buildQuery(params: UseGroupCountsParams): string {
    const qs = new URLSearchParams();
    if (params.groupBy) qs.set("groupBy", params.groupBy);
    if (params.search) qs.set("search", params.search);
    if (params.distributionOrder !== undefined)
        qs.set("distributionOrder", String(params.distributionOrder));
    if (params.filters && params.filters.length > 0)
        qs.set("filters", JSON.stringify(params.filters));
    return qs.toString();
}

export function useGroupCounts(params: UseGroupCountsParams) {
    const key = params.partitionId && params.groupBy
        ? `/api/partitions/${params.partitionId}/records/group-counts?${buildQuery(params)}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<GroupCountsResponse>(key, defaultFetcher);

    return {
        counts: data?.counts ?? {},
        uncategorized: data?.uncategorized ?? 0,
        total: data?.total ?? 0,
        isLoading,
        error,
        mutate,
    };
}
