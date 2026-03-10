import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface PurposeBreakdown {
    purpose: string;
    tokens: number;
}

interface AiUsageData {
    month: string;
    totalTokens: number;
    quotaLimit: number;
    remaining: number;
    usagePercent: number;
    breakdown: PurposeBreakdown[];
}


export function useAiUsage() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: AiUsageData }>(
        "/api/ai/usage",
        defaultFetcher
    );

    return {
        usage: data?.data ?? null,
        isLoading,
        error,
        mutate,
    };
}
