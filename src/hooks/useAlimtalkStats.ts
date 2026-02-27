import useSWR from "swr";
import type { AlimtalkSendLog } from "@/lib/db";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkStats(period: "today" | "week" | "month" = "today") {
    const { data, error, isLoading } = useSWR<StatsResponse>(
        `/api/alimtalk/stats?period=${period}`,
        fetcher,
        { refreshInterval: 30000 }
    );

    return {
        stats: data?.data ?? { total: 0, sent: 0, failed: 0, pending: 0, recentLogs: [] },
        isLoading,
        error,
    };
}
