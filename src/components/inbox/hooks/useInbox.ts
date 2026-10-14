"use client";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
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
    } = { q: "", status: "open", filter: "all" },
) {
    const bootstrap = useSWR<InboxBootstrap>("/api/inbox", inboxRequest);
    const pages = useSWRInfinite<InboxListPage>(
        (index, previous: InboxListPage | null) => {
            if (!channelId || (index > 0 && !previous?.hasMore)) return null;
            const params = new URLSearchParams({
                view: "list",
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
    const list = {
        ...pages,
        data: pages.data
            ?.flatMap((page) => page.rows)
            .filter(
                (row, index, rows) =>
                    rows.findIndex((candidate) => candidate.id === row.id) ===
                    index,
            ),
        counts: pages.data?.[0]?.counts,
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
            `/api/inbox/conversations/${conversationId}`,
            data,
            "PATCH",
        );
        await Promise.all([list.mutate(), detail.mutate()]);
        return updated;
    }
    return { bootstrap, list, detail, patch };
}
