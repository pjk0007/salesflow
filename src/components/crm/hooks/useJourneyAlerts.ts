import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface UseJourneyAlertsParams {
    workspaceId?: number;
    status?: string;
    stage?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}

export interface JourneyAlertRow {
    id: number;
    orgId: string;
    workspaceId: number;
    recordId: number;
    sessionId: number;
    lastActivityAt: string;
    stage: string;
    message: {
        text: string;
        cardsV2?: Array<{
            cardId: string;
            card: {
                header?: { title: string; subtitle: string };
                sections?: Array<{
                    header: string;
                    widgets: Array<{ textParagraph?: { text: string } }>;
                }>;
            };
        }>;
        journeyPriority?: {
            tier: string;
            score: number;
            percentile: number | null;
            evidence: string[];
            customerKey: string;
            rankEligible: boolean;
        };
    };
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    sentAt: string | null;
}

interface JourneyAlertsResponse {
    success: boolean;
    data: JourneyAlertRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

function buildQueryString(params: UseJourneyAlertsParams): string {
    const qs = new URLSearchParams();
    if (params.workspaceId) qs.set("workspaceId", String(params.workspaceId));
    if (params.status) qs.set("status", params.status);
    if (params.stage) qs.set("stage", params.stage);
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return qs.toString();
}

export function useJourneyAlerts(params: UseJourneyAlertsParams = {}) {
    const queryString = buildQueryString(params);
    const { data, error, isLoading, mutate } = useSWR<JourneyAlertsResponse>(
        `/api/crm/journey-alerts?${queryString}`,
        defaultFetcher
    );

    return {
        alerts: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 30,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
    };
}
