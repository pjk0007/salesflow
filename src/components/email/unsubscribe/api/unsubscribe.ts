import type { UnsubscribeTarget } from "../types";

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export async function fetchUnsubscribeTarget(token: string): Promise<UnsubscribeTarget> {
    const res = await fetch(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const json: ApiResponse<UnsubscribeTarget> = await res.json();

    if (!json.success || !json.data) {
        throw new Error(json.error ?? "수신거부 정보를 불러오지 못했습니다.");
    }
    return json.data;
}

export async function submitUnsubscribe(token: string): Promise<void> {
    const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    });
    const json: ApiResponse<{ email: string }> = await res.json();

    if (!json.success) {
        throw new Error(json.error ?? "수신거부 처리에 실패했습니다.");
    }
}

/** 거부 완료 후 사유를 덧붙인다. 실패해도 거부 자체는 유효하므로 조용히 넘긴다. */
export async function submitUnsubscribeReason(token: string, reason: string): Promise<void> {
    const res = await fetch("/api/email/unsubscribe", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason }),
    });
    const json: ApiResponse<never> = await res.json();

    if (!json.success) {
        throw new Error(json.error ?? "사유 전송에 실패했습니다.");
    }
}
