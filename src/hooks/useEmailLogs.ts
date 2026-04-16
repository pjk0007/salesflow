import useSWR from "swr";
import type { EmailSendLog } from "@/lib/db";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface LogsResponse {
    success: boolean;
    data?: EmailSendLog[];
    totalCount?: number;
}


export function useEmailLogs(params?: { partitionId?: number; search?: string; status?: string; triggerType?: string; templateLinkId?: number; autoPersonalizedLinkId?: number; isOpened?: string; isClicked?: string; startDate?: string; endDate?: string; page?: number }) {
    const qs = new URLSearchParams();
    if (params?.partitionId) qs.set("partitionId", String(params.partitionId));
    if (params?.search) qs.set("search", params.search);
    if (params?.status) qs.set("status", params.status);
    if (params?.triggerType) qs.set("triggerType", params.triggerType);
    if (params?.templateLinkId) qs.set("templateLinkId", String(params.templateLinkId));
    if (params?.autoPersonalizedLinkId) qs.set("autoPersonalizedLinkId", String(params.autoPersonalizedLinkId));
    if (params?.isOpened) qs.set("isOpened", params.isOpened);
    if (params?.isClicked) qs.set("isClicked", params.isClicked);
    if (params?.startDate) qs.set("startDate", params.startDate);
    if (params?.endDate) qs.set("endDate", params.endDate);
    if (params?.page) qs.set("page", String(params.page));
    const query = qs.toString() ? `?${qs.toString()}` : "";

    const { data, error, isLoading, mutate } = useSWR<LogsResponse>(
        `/api/email/logs${query}`,
        defaultFetcher
    );

    const syncLogs = async () => {
        const res = await fetch("/api/email/logs/sync", { method: "POST" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        logs: data?.data ?? [],
        totalCount: data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
        syncLogs,
    };
}
