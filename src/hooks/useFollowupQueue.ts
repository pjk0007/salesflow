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

export function useFollowupQueue(params?: { status?: string; sourceType?: string; search?: string; page?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.sourceType) qs.set("sourceType", params.sourceType);
    if (params?.search) qs.set("search", params.search);
    if (params?.page) qs.set("page", String(params.page));
    const query = qs.toString() ? `?${qs.toString()}` : "";

    const { data, error, isLoading, mutate } = useSWR<QueueResponse>(
        `/api/email/followup-queue${query}`,
        defaultFetcher
    );

    const cancelItem = async (id: number) => {
        const res = await fetch(`/api/email/followup-queue/${id}`, { method: "PATCH" });
        const json = await res.json();
        // 실패해도 다시 읽는다 — 그사이 처리 중·발송됨으로 바뀐 줄의 상태가 보이게
        mutate();
        return json;
    };

    return {
        items: data?.data ?? [],
        totalCount: data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
        cancelItem,
    };
}
