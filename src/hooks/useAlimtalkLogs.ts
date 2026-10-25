import useSWR from "swr";
import type { AlimtalkSendLog } from "@/lib/db";
import { apiRequest, blockingError, defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";

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
        defaultFetcher
    );

    // 연결 끊김도 success:false로 돌려 '동기화 중' 상태가 풀리게 한다(UX-180). 동기화는 조회만 하므로 다시 눌러도 안전하다.
    const syncResults = async (logIds?: number[]): Promise<{ success: boolean; data?: { synced: number; updated: number }; error?: string }> => {
        try {
            const result = await apiRequest<{ success: boolean; data: { synced: number; updated: number } }>("/api/alimtalk/logs/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ logIds }),
            }, 60000);
            mutate();
            return result;
        } catch (error) {
            return { success: false, error: requestErrorMessage(error, "결과 동기화를 완료하지 못했습니다. 다시 시도해주세요.") };
        }
    };

    return {
        logs: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
        syncResults,
    };
}
