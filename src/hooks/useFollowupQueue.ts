import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface FollowupQueueItem {
    id: number;
    parentLogId: number;
    sourceType: string;
    sourceId: number;
    stepIndex: number;
    checkAt: string;
    status: string;
    result: string | null;
    processedAt: string | null;
    createdAt: string;
    recipientEmail: string | null;
    parentSubject: string | null;
}

interface QueueResponse {
    success: boolean;
    data?: FollowupQueueItem[];
    totalCount?: number;
}

export function useFollowupQueue(params?: { status?: string; sourceType?: string; page?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.sourceType) qs.set("sourceType", params.sourceType);
    if (params?.page) qs.set("page", String(params.page));
    const query = qs.toString() ? `?${qs.toString()}` : "";

    const { data, error, isLoading, mutate } = useSWR<QueueResponse>(
        `/api/email/followup-queue${query}`,
        defaultFetcher
    );

    return {
        items: data?.data ?? [],
        totalCount: data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
    };
}
