import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { DbRecord } from "@/lib/db";
import type { FilterCondition } from "@/types";

interface UseGroupRecordsParams {
    partitionId: number | null;
    groupBy: string | null;
    groupValue: string;       // "" → 미분류
    page?: number;            // 기본 1
    pageSize?: number;        // 기본 50
    search?: string;
    distributionOrder?: number;
    filters?: FilterCondition[];
    sortField?: string;
    sortOrder?: "asc" | "desc";
    enabled?: boolean;        // 기본 true
}

interface RecordsResponse {
    success: boolean;
    data: DbRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

function buildQuery(params: UseGroupRecordsParams): string {
    const qs = new URLSearchParams();
    qs.set("page", String(params.page ?? 1));
    qs.set("pageSize", String(params.pageSize ?? 50));
    qs.set("groupBy", params.groupBy as string);
    qs.set("groupValue", params.groupValue);
    if (params.search) qs.set("search", params.search);
    if (params.distributionOrder !== undefined)
        qs.set("distributionOrder", String(params.distributionOrder));
    if (params.filters && params.filters.length > 0)
        qs.set("filters", JSON.stringify(params.filters));
    if (params.sortField) qs.set("sortField", params.sortField);
    if (params.sortOrder) qs.set("sortOrder", params.sortOrder);
    return qs.toString();
}

export function useGroupRecords(params: UseGroupRecordsParams) {
    const enabled = params.enabled !== false;
    const key = enabled && params.partitionId && params.groupBy != null
        ? `/api/partitions/${params.partitionId}/records?${buildQuery(params)}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<RecordsResponse>(key, defaultFetcher);

    return {
        records: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
    };
}
