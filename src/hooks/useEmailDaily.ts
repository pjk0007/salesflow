import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface EmailDailyBreakdown {
    triggerType: string;
    product: string;
    campaign: string;
    sent: number;
    clicked: number;
    opened: number;
    openBase: number;
}

export interface EmailDailyGroup {
    date: string;
    totalSent: number;
    totalClicked: number;
    totalOpened: number;
    totalOpenBase: number;
    breakdown: EmailDailyBreakdown[];
}

export function useEmailDaily(startDate: string, endDate: string) {
    const { data, isLoading } = useSWR<{ success: boolean; data?: EmailDailyGroup[] }>(
        `/api/analytics/email-daily?startDate=${startDate}&endDate=${endDate}`,
        defaultFetcher,
    );
    return {
        days: data?.data ?? [],
        isLoading,
    };
}
