import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { operationsRequest } from "../api";
import type {
    NotificationPage,
    OperationsSettings,
    OperationsReport,
    ConversationOperations,
} from "../types";
import type { StatsQuery } from "./useStatsFilters";
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
const reportKey = (id: number, q: StatsQuery, before?: string) =>
    `/api/inbox-operations/reports?${new URLSearchParams({ channelId: String(id), from: q.from, to: q.to, medium: q.medium, ...(before ? { before } : {}) })}`;
/** 응대 성과 한 묶음 (before: 응대별 목록 다음 페이지 위치) */
export function useOperationsReport(id: number, q: StatsQuery | null, before?: string) {
    return useSWR(q ? reportKey(id, q, before) : null, operationsRequest<OperationsReport>, {
        refreshInterval: 30000,
        refreshWhenHidden: false,
    });
}
/** 비교용 — 여러 묶음(기간·매체)을 한 번에 */
export function useOperationsReports(id: number, queries: StatsQuery[] | null) {
    return useSWR(
        queries ? ["operations-reports", ...queries.map((q) => reportKey(id, q))] : null,
        ([, ...keys]: string[]) => Promise.all(keys.map((k) => operationsRequest<OperationsReport>(k))),
        { refreshInterval: 30000, refreshWhenHidden: false },
    );
}
