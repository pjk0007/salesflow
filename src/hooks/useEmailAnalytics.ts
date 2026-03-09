import useSWR from "swr";

interface EmailStats {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    opened: number;
    openRate: number;
}

interface AlimtalkStats {
    total: number;
    sent: number;
    failed: number;
    pending: number;
}

interface TriggerBreakdownItem {
    triggerType: string;
    total: number;
    sent: number;
    failed: number;
    opened: number;
    successRate: number;
    openRate: number;
}

interface SummaryData {
    email: EmailStats;
    alimtalk: AlimtalkStats;
    newRecordsInPeriod: number;
    triggerBreakdown: TriggerBreakdownItem[];
}

interface TrendItem {
    date: string;
    emailSent: number;
    emailFailed: number;
    emailOpened: number;
    alimtalkSent: number;
    alimtalkFailed: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEmailAnalytics(startDate: string, endDate: string) {
    const { data: summaryData, isLoading: summaryLoading } = useSWR<{ success: boolean; data: SummaryData }>(
        `/api/analytics/summary?startDate=${startDate}&endDate=${endDate}`,
        fetcher
    );
    const { data: trendsData, isLoading: trendsLoading } = useSWR<{ success: boolean; data: TrendItem[] }>(
        `/api/analytics/trends?startDate=${startDate}&endDate=${endDate}&channel=email`,
        fetcher
    );

    return {
        summary: summaryData?.data ?? null,
        trends: trendsData?.data ?? [],
        isLoading: summaryLoading || trendsLoading,
    };
}
