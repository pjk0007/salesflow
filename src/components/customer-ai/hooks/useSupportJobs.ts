"use client";
import useSWRInfinite from "swr/infinite";
import { supportRequest } from "../api";
import type { SupportJobSummary } from "../types";
export function useSupportJobs(id: string, opened: boolean) {
    return useSWRInfinite<{ rows: SupportJobSummary[]; hasMore: boolean }>(
        (index, previous) =>
            !opened || (previous && !previous.hasMore)
                ? null
                : `/api/inbox/conversations/${id}/ai${index ? `?before=${previous!.rows.at(-1)!.id}` : ""}`,
        supportRequest,
        { refreshInterval: opened ? 3000 : 0, refreshWhenHidden: false },
    );
}
