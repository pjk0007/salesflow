import useSWR from "swr";

interface ChannelStats {
    total: number;
    sent: number;
    failed: number;
    pending: number;
}

interface AlimtalkLog {
    id: number;
    recipientNo: string;
    templateName: string | null;
    status: string;
    sentAt: string;
}

interface EmailLog {
    id: number;
    recipientEmail: string;
    subject: string | null;
    status: string;
    sentAt: string;
}

export interface DashboardSummary {
    recordCount: number;
    workspaceCount: number;
    partitionCount: number;
    alimtalk: ChannelStats;
    email: ChannelStats;
    recentAlimtalkLogs: AlimtalkLog[];
    recentEmailLogs: EmailLog[];
}

interface SummaryResponse {
    success: boolean;
    data?: DashboardSummary;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const empty: DashboardSummary = {
    recordCount: 0,
    workspaceCount: 0,
    partitionCount: 0,
    alimtalk: { total: 0, sent: 0, failed: 0, pending: 0 },
    email: { total: 0, sent: 0, failed: 0, pending: 0 },
    recentAlimtalkLogs: [],
    recentEmailLogs: [],
};

export function useDashboardSummary() {
    const { data, error, isLoading } = useSWR<SummaryResponse>(
        "/api/dashboard/summary",
        fetcher,
        { refreshInterval: 60000 }
    );

    return {
        summary: data?.data ?? empty,
        isLoading,
        error,
    };
}
