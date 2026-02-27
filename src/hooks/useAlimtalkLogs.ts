import useSWR from "swr";
import type { AlimtalkSendLog } from "@/lib/db";

interface UseAlimtalkLogsParams {
    partitionId?: number | null;
    templateLinkId?: number | null;
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
}

interface LogsResponse {
    success: boolean;
    data: AlimtalkSendLog[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function buildQueryString(params: UseAlimtalkLogsParams): string {
    const qs = new URLSearchParams();
    if (params.partitionId) qs.set("partitionId", String(params.partitionId));
    if (params.templateLinkId) qs.set("templateLinkId", String(params.templateLinkId));
    if (params.status) qs.set("status", params.status);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return qs.toString();
}

export function useAlimtalkLogs(params: UseAlimtalkLogsParams = {}) {
    const queryString = buildQueryString(params);
    const { data, error, isLoading, mutate } = useSWR<LogsResponse>(
        `/api/alimtalk/logs?${queryString}`,
        fetcher
    );

    const syncResults = async (logIds?: number[]) => {
        const res = await fetch("/api/alimtalk/logs/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logIds }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        logs: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
        syncResults,
    };
}
