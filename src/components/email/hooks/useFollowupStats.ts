import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface FollowupStatRow {
    workspaceId: number;
    workspaceName: string;
    ruleName: string;
    ruleType: string;
    step: string;
    totalCount: number;
    sentCount: number;
    clickCount: number;
}

interface FollowupStatsResponse {
    success: boolean;
    data: FollowupStatRow[];
}

export function useFollowupStats(startDate: string, endDate: string) {
    const { data, error, isLoading } = useSWR<FollowupStatsResponse>(
        startDate && endDate
            ? `/api/email/followup-stats?startDate=${startDate}&endDate=${endDate}`
            : null,
        defaultFetcher
    );

    return {
        rows: data?.data ?? [],
        isLoading,
        error,
    };
}
