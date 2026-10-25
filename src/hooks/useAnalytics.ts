import useSWR from "swr";
import { blockingError, defaultFetcher } from "@/lib/swr-fetcher";
import { presetRange } from "@/lib/email-stats/rules";

export interface TrendItem {
    date: string;
    alimtalkSent: number;
    alimtalkFailed: number;
    emailSent: number;
    emailFailed: number;
    emailClicked: number;
    emailOpened: number;
}

export interface ChannelSummary {
    total: number;
    sent: number;
    failed: number;
    pending: number;
}

export interface AnalyticsSummary {
    alimtalk: ChannelSummary;
    email: ChannelSummary;
    newRecordsInPeriod: number;
    /** 이메일 수치의 집계 기준 시각 (15분 집계표). null = 집계 준비 중 */
    emailAsOf?: string | null;
}

export interface TemplatePerformance {
    name: string;
    channel: "alimtalk" | "email";
    type: "template" | "link" | "ai_auto";
    total: number;
    sent: number;
    failed: number;
    clicked: number;
    successRate: number;
    clickRate: number;
    opened: number;
    openBase: number;
    openRate: number | null;
}

export type Period = "7d" | "30d" | "90d";

function getDateRange(period: Period): { startDate: string; endDate: string } {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const { from, to } = presetRange(days, new Date());
    return { startDate: from, endDate: to };
}


const emptySummary: AnalyticsSummary = {
    alimtalk: { total: 0, sent: 0, failed: 0, pending: 0 },
    email: { total: 0, sent: 0, failed: 0, pending: 0 },
    newRecordsInPeriod: 0,
};

export function useAnalytics(period: Period = "30d", channel: string = "all") {
    const { startDate, endDate } = getDateRange(period);

    const trendsKey = `/api/analytics/trends?startDate=${startDate}&endDate=${endDate}&channel=${channel}`;
    const summaryKey = `/api/analytics/summary?startDate=${startDate}&endDate=${endDate}`;
    const templatesKey = `/api/analytics/templates?startDate=${startDate}&endDate=${endDate}&channel=${channel}&limit=10`;

    const { data: trendsData, error: trendsError, isLoading: trendsLoading, mutate: mutateTrends } = useSWR<{
        success: boolean;
        data?: TrendItem[];
    }>(trendsKey, defaultFetcher, { refreshInterval: 900000, revalidateOnFocus: false });

    const { data: summaryData, error: summaryError, isLoading: summaryLoading, mutate: mutateSummary } = useSWR<{
        success: boolean;
        data?: AnalyticsSummary;
    }>(summaryKey, defaultFetcher, { refreshInterval: 900000, revalidateOnFocus: false });

    const { data: templatesData, error: templatesError, isLoading: templatesLoading, mutate: mutateTemplates } = useSWR<{
        success: boolean;
        data?: TemplatePerformance[];
    }>(templatesKey, defaultFetcher, { refreshInterval: 900000, revalidateOnFocus: false });

    return {
        trends: trendsData?.data ?? [],
        summary: summaryData?.data ?? emptySummary,
        templates: templatesData?.data ?? [],
        isLoading: trendsLoading || summaryLoading || templatesLoading,
        error: trendsError || summaryError || templatesError,
        loadError: blockingError(trendsData, trendsError) || blockingError(summaryData, summaryError) ||
            blockingError(templatesData, templatesError),
        mutate: () => Promise.all([mutateTrends(), mutateSummary(), mutateTemplates()]),
    };
}
