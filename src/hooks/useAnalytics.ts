import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface TrendItem {
    date: string;
    alimtalkSent: number;
    alimtalkFailed: number;
    emailSent: number;
    emailFailed: number;
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
}

export interface TemplatePerformance {
    name: string;
    channel: "alimtalk" | "email";
    type: "template" | "link" | "ai_auto";
    total: number;
    sent: number;
    failed: number;
    opened: number;
    successRate: number;
}

export type Period = "7d" | "30d" | "90d";

function getDateRange(period: Period): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date();
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    start.setDate(start.getDate() - days);
    return {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
    };
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

    const { data: trendsData, isLoading: trendsLoading } = useSWR<{
        success: boolean;
        data?: TrendItem[];
    }>(trendsKey, defaultFetcher, { refreshInterval: 60000 });

    const { data: summaryData, isLoading: summaryLoading } = useSWR<{
        success: boolean;
        data?: AnalyticsSummary;
    }>(summaryKey, defaultFetcher, { refreshInterval: 60000 });

    const { data: templatesData, isLoading: templatesLoading } = useSWR<{
        success: boolean;
        data?: TemplatePerformance[];
    }>(templatesKey, defaultFetcher, { refreshInterval: 60000 });

    return {
        trends: trendsData?.data ?? [],
        summary: summaryData?.data ?? emptySummary,
        templates: templatesData?.data ?? [],
        isLoading: trendsLoading || summaryLoading || templatesLoading,
    };
}
