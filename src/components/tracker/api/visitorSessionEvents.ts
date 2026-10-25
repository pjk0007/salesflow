import { apiRequest } from "@/lib/swr-fetcher";
import type { TrackerEvent } from "../types";

/** 방문자 상세 세션의 beforeId 이전 행동을 시간순으로 받는다. 실패는 RequestError로 던진다. */
export async function fetchOlderSessionEvents(
    visitorPk: number,
    sessionId: number,
    beforeId: number,
): Promise<{ events: TrackerEvent[]; hasMore: boolean }> {
    const qs = new URLSearchParams({ sessionId: String(sessionId), beforeId: String(beforeId) });
    const res = await apiRequest<{ success: true; data: { events: TrackerEvent[]; hasMore: boolean } }>(
        `/api/tracker/visitors/${visitorPk}/events?${qs.toString()}`,
    );
    return res.data;
}
