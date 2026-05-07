"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { TrackerSite } from "../types";

type Response = { success: true; data: TrackerSite | null } | { success: false; error: string };

export function useTrackerSite(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<Response>(
        workspaceId ? `/api/tracker/sites?workspaceId=${workspaceId}` : null,
        defaultFetcher,
    );

    const site = data?.success ? data.data : null;

    return {
        site,
        isLoading,
        error: error || (data && !data.success ? new Error(data.error) : null),
        mutate,
    };
}
