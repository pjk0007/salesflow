import useSWR from "swr";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAiUsage() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: AiUsageData }>(
        "/api/ai/usage",
        fetcher
    );

    return {
        usage: data?.data ?? null,
        isLoading,
        error,
        mutate,
    };
}
