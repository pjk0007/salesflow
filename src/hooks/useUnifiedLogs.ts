import useSWR from "swr";
import type { UnifiedLog } from "@/types";

interface UseUnifiedLogsParams {
    channel?: string;
    status?: string;
    triggerType?: string;
    startDate?: string;
    endDate?: string;
    recordId?: number | null;
    search?: string;
    page?: number;
    pageSize?: number;
}

interface UnifiedLogsResponse {
    success: boolean;
    data: UnifiedLog[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function buildQueryString(params: UseUnifiedLogsParams): string {
    const qs = new URLSearchParams();
    if (params.channel) qs.set("channel", params.channel);
    if (params.status) qs.set("status", params.status);
    if (params.triggerType) qs.set("triggerType", params.triggerType);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.recordId) qs.set("recordId", String(params.recordId));
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return qs.toString();
}

export function useUnifiedLogs(params: UseUnifiedLogsParams = {}) {
    const queryString = buildQueryString(params);
    const { data, error, isLoading, mutate } = useSWR<UnifiedLogsResponse>(
        `/api/logs/unified?${queryString}`,
        fetcher
    );

    return {
        logs: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
    };
}
