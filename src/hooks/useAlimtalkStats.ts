import useSWR from "swr";
import type { AlimtalkSendLog } from "@/lib/db";
import { blockingError, defaultFetcher } from "@/lib/swr-fetcher";

interface StatsData {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    recentLogs: AlimtalkSendLog[];
}

interface StatsResponse {
    success: boolean;
    data?: StatsData;
}


export function useAlimtalkStats(period: "today" | "week" | "month" = "today") {
    const { data, error, isLoading, mutate } = useSWR<StatsResponse>(
        `/api/alimtalk/stats?period=${period}`,
        defaultFetcher,
        { refreshInterval: 30000 }
    );

    return {
        stats: data?.data ?? { total: 0, sent: 0, failed: 0, pending: 0, recentLogs: [] },
        isLoading,
        mutate,
        error,
        loadError: blockingError(data, error),
    };
}
