import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface SendStatRow {
    workspaceId: number;
    workspaceName: string;
    partitionId: number;
    partitionName: string;
    date: string;
    totalCount: number;
    sentCount: number;
    clickCount: number;
}

interface SendStatsResponse {
    success: boolean;
    data: SendStatRow[];
}

export function useEmailSendStats(startDate: string, endDate: string) {
    const { data, error, isLoading } = useSWR<SendStatsResponse>(
        startDate && endDate
            ? `/api/email/send-stats?startDate=${startDate}&endDate=${endDate}`
            : null,
        defaultFetcher
    );

    return {
        rows: data?.data ?? [],
        isLoading,
        error,
    };
}
