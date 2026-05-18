"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { TrackerVisitor } from "../types";

type Response =
    | {
          success: true;
          data: TrackerVisitor[];
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
      }
    | { success: false; error: string };

type Args = {
    siteId: number | null;
    page: number;
    q?: string;
    hasRecord?: "true" | "false" | "";
};

export function useTrackerVisitors({ siteId, page, q, hasRecord }: Args) {
    const key = siteId
        ? `/api/tracker/visitors?${new URLSearchParams({
              siteId: String(siteId),
              page: String(page),
              ...(q ? { q } : {}),
              ...(hasRecord ? { hasRecord } : {}),
          }).toString()}`
        : null;

    const { data, isLoading, mutate } = useSWR<Response>(key, defaultFetcher);

    const ok = data?.success ? data : null;

    return {
        items: ok?.data ?? [],
        page: ok?.page ?? page,
        total: ok?.total ?? 0,
        totalPages: ok?.totalPages ?? 1,
        isLoading,
        mutate,
    };
}
