"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { RecordVisitorActivity } from "../types";

type Response =
    | { success: true; data: RecordVisitorActivity }
    | { success: false; error: string };

export function useRecordVisitorActivity(recordId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<Response>(
        recordId ? `/api/records/${recordId}/visitor-activity` : null,
        defaultFetcher,
    );

    const activity = data?.success ? data.data : null;

    return {
        activity,
        isLoading,
        error: error || (data && !data.success ? new Error(data.error) : null),
        mutate,
    };
}
