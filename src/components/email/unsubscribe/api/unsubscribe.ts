import { apiRequest } from "@/lib/swr-fetcher";
import type { UnsubscribeTarget } from "../types";

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// 전송·시간 초과·비JSON·HTTP 오류는 공통 apiRequest가 한국어 RequestError로 던진다 (UX-152).
// 영어 원문(Failed to fetch, Unexpected token …)이 수신자 화면에 나오지 않는다.

export async function fetchUnsubscribeTarget(token: string): Promise<UnsubscribeTarget> {
    const json = await apiRequest<ApiResponse<UnsubscribeTarget>>(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`);
    if (!json.data) throw new Error("수신거부 정보를 불러오지 못했습니다.");
    return json.data;
}

/** 서버는 이미 거부한 주소도 성공으로 답한다 — 응답을 못 받아 다시 보내도 중복 기록되지 않는다 */
export async function submitUnsubscribe(token: string): Promise<void> {
    await apiRequest("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    });
}

/** 거부 완료 후 사유를 덧붙인다. 실패해도 거부 자체는 유효하므로 조용히 넘긴다. */
export async function submitUnsubscribeReason(token: string, reason: string): Promise<void> {
    await apiRequest("/api/email/unsubscribe", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason }),
    });
}
