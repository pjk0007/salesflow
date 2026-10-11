import type { ApiResult, WebhookCheckResult } from "../types";

/** 화면 데이터 (명단 표·주소·도메인·사건). 대시보드 카드·규칙 카드·발신 주소 목록이 같은 키를 쓴다 */
export const SEND_HEALTH_KEY = "/api/email/send-health";
/** 보류 중인 명단만 (명단 목록·레코드 화면 머리 — 가볍게) */
export const SEND_HEALTH_HOLDS_KEY = "/api/email/send-health?scope=holds";

async function post<T>(url: string, body: unknown): Promise<ApiResult<T>> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
        });
        return (await res.json()) as ApiResult<T>;
    } catch {
        return { success: false, error: "서버에 연결하지 못했습니다." };
    }
}

/** 명단 보류 풀기 (관리자) */
export function releaseHold(holdId: number, note: string): Promise<ApiResult<{ partitionId: number; releasedAt: string }>> {
    return post(`/api/email/send-health/holds/${holdId}/release`, { note: note.trim() || undefined });
}

/** 구글 챗 웹훅 연결 확인 — 받는 곳마다 확인 글 한 통 (관리자, 10분에 한 번, WPN-11) */
export function checkWebhooks(): Promise<ApiResult<{ results: WebhookCheckResult[] }>> {
    return post("/api/email/send-health/webhook-check", {});
}

/** 발신 주소 자동 멈춤 풀기 (관리자) */
export function releaseSender(
    profileId: number,
    note: string
): Promise<ApiResult<{ profileId: number; todayCap: number | null; warmupDay: number | null }>> {
    return post(`/api/email/send-health/senders/${profileId}/release`, { note: note.trim() || undefined });
}
