import { readImportResponse } from "@/components/records/api/import-response";
import useSWR, { mutate as globalMutate } from "swr";
import type { DbRecord } from "@/lib/db";
import type { FilterCondition, ImportResult } from "@/types";
import { blockingError, defaultFetcher, RequestError } from "@/lib/swr-fetcher";

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
        distributionOrder?: number;
        filters?: FilterCondition[];
        sortField?: string;
        sortOrder?: string;
    }) => {
        const qs = new URLSearchParams();
        if (exportParams.distributionOrder !== undefined) qs.set("distributionOrder", String(exportParams.distributionOrder));
        if (exportParams.search) qs.set("search", exportParams.search);
        if (exportParams.filters && exportParams.filters.length > 0)
            qs.set("filters", JSON.stringify(exportParams.filters));
        if (exportParams.sortField) qs.set("sortField", exportParams.sortField);
        if (exportParams.sortOrder) qs.set("sortOrder", exportParams.sortOrder);

        const res = await fetch(
            `/api/partitions/${params.partitionId}/records/export?${qs.toString()}`
        );
        if (!res.ok) {
            // 권한·서버 오류의 한국어 안내를 살린다(UX-072)
            const body = await res.json().catch(() => null);
            const message = typeof body?.error === "string" ? body.error : "CSV 내보내기에 실패했습니다.";
            throw new RequestError(message, res.status, typeof body?.error === "string");
        }
        // 서버가 정한 파일 이름(KST 날짜)을 그대로 쓴다(UX-073)
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const encoded = /filename="([^"]+)"/.exec(disposition)?.[1];
        let filename: string | null = null;
        try {
            filename = encoded ? decodeURIComponent(encoded) : null;
        } catch {
            filename = null;
        }
        return { blob: await res.blob(), filename };
    };

    const bulkImport = async (
        importRecords: Array<Record<string, unknown>>,
        duplicateAction: "skip" | "error" = "skip",
        onProgress?: (p: { processed: number; total: number }) => void
    ): Promise<ImportResult> => {
        const res = await fetch(
            `/api/partitions/${params.partitionId}/records/bulk-import`,
            {
                method: "POST",
                headers: jsonHeaders(),
                body: JSON.stringify({ records: importRecords, duplicateAction }),
            }
        );

        const result = await readImportResponse(res, onProgress);
        if (result.success && (result.insertedCount > 0 || (result.mergedCount ?? 0) > 0)) mutate();
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
        loadError: blockingError(data, error),
        mutate,
        createRecord,
        updateRecord,
        deleteRecord,
        exportCsv,
        bulkImport,
        bulkDelete,
    };
}
