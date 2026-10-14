import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { operationsRequest } from "../api";
import type {
    NotificationPage,
    OperationsSettings,
    OperationsReport,
    ConversationOperations,
} from "../types";
export const useOperationsSettings = (id: number) =>
    useSWR(
        `/api/inbox-operations/channels/${id}`,
        operationsRequest<OperationsSettings>,
    );
export const useConversationOperations = (id: string) =>
    useSWR(
        `/api/inbox-operations/conversations/${id}`,
        operationsRequest<ConversationOperations>,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
export function useSupportNotifications(unread = false) {
    return useSWRInfinite<NotificationPage>(
        (index, previous) => {
            if (index > 0 && !previous?.hasMore) return null;
            return `/api/inbox-notifications?unread=${unread}${index && previous?.rows.at(-1) ? `&before=${previous.rows.at(-1)!.id}` : ""}`;
        },
        operationsRequest,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
}
export const useNotificationCount = () =>
    useSWR(
        "/api/inbox-notifications?unread=true",
        operationsRequest<NotificationPage>,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
export function useOperationsReport(
    id: number,
    from: string,
    to: string,
    medium: string,
    before?: string,
) {
    return useSWR(
        from && to
            ? `/api/inbox-operations/reports?${new URLSearchParams({ channelId: String(id), from, to, medium, ...(before ? { before } : {}) })}`
            : null,
        operationsRequest<OperationsReport>,
        { refreshInterval: 30000, refreshWhenHidden: false },
    );
}
