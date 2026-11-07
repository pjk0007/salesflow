"use client";
import useSWR from "swr";
import { careUrl, relationshipRequest, todayUrl } from "../api";
import type { Care, TodayData } from "../types";
export function useToday(workspaceId: number | null, scope: "mine" | "all") {
    return useSWR<TodayData>(
        workspaceId ? todayUrl(workspaceId, scope) : null,
        relationshipRequest,
        { refreshInterval: 60000, refreshWhenHidden: false },
    );
}
export function useCare(workspaceId: number | null, contactId: string | null) {
    return useSWR<{ care: Care | null }>(
        workspaceId && contactId ? careUrl(workspaceId, contactId) : null,
        relationshipRequest,
    );
}
