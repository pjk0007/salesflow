import useSWR, { mutate as globalMutate } from "swr";
import type { DbRecord } from "@/lib/db";
import type { FilterCondition, ImportResult } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface UseRecordsParams {
    partitionId: number | null;
    page?: number;
    pageSize?: number;
    search?: string;
    distributionOrder?: number;
    sortField?: string;
    sortOrder?: "asc" | "desc";
    filters?: FilterCondition[];
    sessionId?: string;
}

interface RecordsResponse {
    success: boolean;
    data: DbRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

function buildQueryString(params: UseRecordsParams): string {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.search) qs.set("search", params.search);
    if (params.distributionOrder !== undefined)
        qs.set("distributionOrder", String(params.distributionOrder));
    if (params.sortField) qs.set("sortField", params.sortField);
    if (params.sortOrder) qs.set("sortOrder", params.sortOrder);
    if (params.filters && params.filters.length > 0)
        qs.set("filters", JSON.stringify(params.filters));
    return qs.toString();
}


export function useRecords(params: UseRecordsParams) {
    const queryString = buildQueryString(params);
    const key = params.partitionId
        ? `/api/partitions/${params.partitionId}/records?${queryString}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<RecordsResponse>(key, defaultFetcher);

    const jsonHeaders = (): Record<string, string> => {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (params.sessionId) h["x-session-id"] = params.sessionId;
        return h;
    };

    const createRecord = async (recordData: Record<string, unknown>) => {
        const res = await fetch(`/api/partitions/${params.partitionId}/records`, {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify({ data: recordData }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateRecord = async (id: number, recordData: Record<string, unknown>) => {
        // 낙관적 업데이트: 같은 파티션의 모든 records SWR 캐시에서 해당 레코드를 즉시 갱신
        // (그룹뷰의 useGroupRecords 키도 동일 prefix를 사용하므로 한 번에 처리)
        const cachePrefix = `/api/partitions/${params.partitionId}/records?`;
        globalMutate(
            (key) => typeof key === "string" && key.startsWith(cachePrefix),
            (current: RecordsResponse | undefined) =>
                current && {
                    ...current,
                    data: current.data.map((r) =>
                        r.id === id
                            ? {
                                ...r,
                                data: {
                                    ...(r.data as Record<string, unknown>),
                                    ...recordData,
                                },
                            }
                            : r,
                    ),
                },
            { revalidate: false },
        );

        const res = await fetch(`/api/records/${id}`, {
            method: "PATCH",
            headers: jsonHeaders(),
            body: JSON.stringify({ data: recordData }),
        });
        const result = await res.json();

        // 최종 동기화 (서버측 가공/실패 시 롤백 포함)
        globalMutate(
            (key) => typeof key === "string" && key.startsWith(cachePrefix),
        );

        return result;
    };

    const deleteRecord = async (id: number) => {
        const headers: Record<string, string> = {};
        if (params.sessionId) headers["x-session-id"] = params.sessionId;
        const res = await fetch(`/api/records/${id}`, { method: "DELETE", headers });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const exportCsv = async (exportParams: {
        search?: string;
        filters?: FilterCondition[];
        sortField?: string;
        sortOrder?: string;
    }) => {
        const qs = new URLSearchParams();
        if (exportParams.search) qs.set("search", exportParams.search);
        if (exportParams.filters && exportParams.filters.length > 0)
            qs.set("filters", JSON.stringify(exportParams.filters));
        if (exportParams.sortField) qs.set("sortField", exportParams.sortField);
        if (exportParams.sortOrder) qs.set("sortOrder", exportParams.sortOrder);

        const res = await fetch(
            `/api/partitions/${params.partitionId}/records/export?${qs.toString()}`
        );
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
    };

    const bulkImport = async (
        importRecords: Array<Record<string, unknown>>,
        duplicateAction: "skip" | "error" = "skip"
    ): Promise<ImportResult> => {
        const res = await fetch(
            `/api/partitions/${params.partitionId}/records/bulk-import`,
            {
                method: "POST",
                headers: jsonHeaders(),
                body: JSON.stringify({ records: importRecords, duplicateAction }),
            }
        );
        const result = await res.json();
        if (result.success && result.insertedCount > 0) mutate();
        return result;
    };

    const bulkDelete = async (ids: number[]) => {
        const res = await fetch("/api/records/bulk-delete", {
            method: "POST",
            headers: jsonHeaders(),
            body: JSON.stringify({ ids }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        records: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
        createRecord,
        updateRecord,
        deleteRecord,
        exportCsv,
        bulkImport,
        bulkDelete,
    };
}
