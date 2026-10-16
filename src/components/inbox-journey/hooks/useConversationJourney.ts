"use client";
import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
import type { ConversationJourney } from "../types";
export function useConversationJourney(id: string, version: number) {
    return useSWR<ConversationJourney>(`/api/inbox/conversations/${id}/journey?v=${version}`, inboxRequest, {
        refreshInterval: 15000, refreshWhenHidden: false, keepPreviousData: false,
    });
}
