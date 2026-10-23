"use client";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { useMemo } from "react";
import { inboxRequest, inboxWrite } from "../api";
import type {
    Conversation,
    ConversationFilter,
    ConversationStatus,
    ChatMessage,
    InboxBootstrap,
    InboxListPage,
} from "../types";
export function useInbox(
    channelId: number | null,
    conversationId: string | null,
    filters: {
        q: string;
        status: ConversationStatus;
        filter: ConversationFilter;
        teamId?: string;
    } = { q: "", status: "open", filter: "all" },
) {
    const { mutate } = useSWRConfig();
    const bootstrap = useSWR<InboxBootstrap>("/api/inbox", inboxRequest, {
        refreshInterval: 15000,
    });
    const pages = useSWRInfinite<InboxListPage>(
        (index, previous: InboxListPage | null) => {
            if (!channelId || (index > 0 && !previous?.hasMore)) return null;
            const params = new URLSearchParams({
                view: "rows",
                channelId: String(channelId),
                ...filters,
            });
            const last = previous?.rows.at(-1);
            if (index > 0 && last) {
                params.set("before", last.lastMessageAt);
                params.set("beforeId", last.id);
            }
            return `/api/inbox?${params}`;
        },
        inboxRequest,
        { refreshInterval: 4000, refreshWhenHidden: false },
    );
    const counts = useSWR<Record<ConversationFilter, number>>(
        channelId ? `/api/inbox?${new URLSearchParams({ view: "counts", channelId: String(channelId), ...filters })}` : null,
        inboxRequest,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
    const rows = useMemo(() => {
        const seen = new Set<string>();
        return pages.data?.flatMap(page => page.rows).filter(row => {
            if (seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
        });
    }, [pages.data]);
    const list = {
        ...pages,
        data: rows,
        counts: counts.data,
        countsError: counts.error,
        refreshCounts: counts.mutate,
        hasMore: pages.data?.at(-1)?.hasMore ?? false,
        loadMore: () => pages.setSize(pages.size + 1),
        loadingMore: !!pages.data && !pages.data[pages.size - 1],
    };
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
            `/api/inbox/conversations/${detail.data?.conversation.id ?? conversationId}`,
            { version: detail.data?.conversation.version, ...(data as object) },
            "PATCH",
        );
        void counts.mutate().catch(() => {});
        await Promise.all([list.mutate(), detail.mutate()]);
        return updated;
    }
    async function receiveMessage(id: string, message: ChatMessage) {
        // Use the captured conversation key, even if the agent switched while sending.
        await mutate(`/api/inbox/conversations/${id}`, (current: typeof detail.data) => {
            if (!current || current.conversation.id !== id) return current;
            return { ...current, messages: [...current.messages.filter(m => m.id !== message.id), message].sort((a, b) => a.id - b.id) };
        }, { revalidate: false });
    }
    return { bootstrap, list, detail, patch, receiveMessage };
}
