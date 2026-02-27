import useSWR from "swr";
import type { EmailSendLog } from "@/lib/db";

interface LogsResponse {
    success: boolean;
    data?: EmailSendLog[];
    totalCount?: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEmailLogs(params?: { partitionId?: number; triggerType?: string; page?: number }) {
    const qs = new URLSearchParams();
    if (params?.partitionId) qs.set("partitionId", String(params.partitionId));
    if (params?.triggerType) qs.set("triggerType", params.triggerType);
    if (params?.page) qs.set("page", String(params.page));
    const query = qs.toString() ? `?${qs.toString()}` : "";

    const { data, error, isLoading, mutate } = useSWR<LogsResponse>(
        `/api/email/logs${query}`,
        fetcher
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
