"use client";

import useSWRInfinite from "swr/infinite";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { TrackerVisitor } from "../types";

type Page = {
    success: true;
    data: TrackerVisitor[];
    nextCursor: string | null;
} | { success: false; error: string };

type Args = {
    siteId: number | null;
    q?: string;
    hasRecord?: "true" | "false" | "";
};

export function useTrackerVisitors({ siteId, q, hasRecord }: Args) {
    const getKey = (pageIndex: number, prev: Page | null) => {
        if (!siteId) return null;
        if (prev && prev.success && !prev.nextCursor) return null;
        const params = new URLSearchParams({ siteId: String(siteId) });
        if (q) params.set("q", q);
        if (hasRecord) params.set("hasRecord", hasRecord);
        if (prev && prev.success && prev.nextCursor) {
            params.set("cursor", prev.nextCursor);
        }
        return `/api/tracker/visitors?${params.toString()}`;
    };

    const { data, isLoading, size, setSize, mutate } = useSWRInfinite<Page>(
        getKey,
        defaultFetcher,
    );

    const items = data
        ? data.flatMap((page) => (page.success ? page.data : []))
        : [];
    const hasMore = data
        ? Boolean(data[data.length - 1]?.success && (data[data.length - 1] as { nextCursor: string | null }).nextCursor)
        : false;

    return {
        items,
        isLoading,
        hasMore,
        loadMore: () => setSize(size + 1),
        mutate,
    };
}
