"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export type TrackerPageItem = {
    path: string;
    title: string | null;
    views: number;
};

type Response =
    | { success: true; data: TrackerPageItem[] }
    | { success: false; error: string };

/** 사이트의 방문된 페이지 목록 (페이지 필터 드롭다운용) */
export function useTrackerPages(siteId: number | null) {
    const { data, isLoading } = useSWR<Response>(
        siteId ? `/api/tracker/analytics/pages?siteId=${siteId}` : null,
        defaultFetcher,
    );

    return {
        pages: data?.success ? data.data : [],
        isLoading,
    };
}
