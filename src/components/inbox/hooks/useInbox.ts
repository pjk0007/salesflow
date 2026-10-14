"use client";
import useSWR from "swr";
import { inboxRequest, inboxWrite } from "../api";
import type { Conversation, ChatMessage, InboxBootstrap } from "../types";
export function useInbox(
    channelId: number | null,
    conversationId: string | null,
) {
    const bootstrap = useSWR<InboxBootstrap>("/api/inbox", inboxRequest);
    const list = useSWR<Conversation[]>(
        channelId ? `/api/inbox?channelId=${channelId}` : null,
        inboxRequest,
        { refreshInterval: 4000, refreshWhenHidden: false },
    );
    const detail = useSWR<{
        conversation: Conversation;
        messages: ChatMessage[];
        hasOlder: boolean;
    }>(
        conversationId ? `/api/inbox/conversations/${conversationId}` : null,
        inboxRequest,
        { refreshInterval: 3000, refreshWhenHidden: false },
    );
    async function patch(data: unknown) {
        const updated = await inboxWrite<Conversation>(
            `/api/inbox/conversations/${conversationId}`,
            data,
            "PATCH",
        );
        await Promise.all([list.mutate(), detail.mutate()]);
        return updated;
    }
    return { bootstrap, list, detail, patch };
}
