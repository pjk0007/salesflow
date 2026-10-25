export interface UnsubscribeTarget {
    email: string;
    alreadyUnsubscribed: boolean;
}

// 자유 입력은 응답률이 낮아 선택지로 받는다. 마지막 항목만 직접 입력.
export const UNSUBSCRIBE_REASONS = [
    "메일이 너무 자주 옵니다",
    "관심 있는 내용이 아닙니다",
    "신청한 적이 없습니다",
    "기타",
] as const;

export type UnsubscribeReason = (typeof UNSUBSCRIBE_REASONS)[number];

export type UnsubscribeStatus =
    | { kind: "loading" }
    | { kind: "invalid"; message: string }
    /** 일시 오류 — 같은 조회(load) 또는 같은 제출(submit)을 다시 할 수 있다 (UX-152) */
    | { kind: "error"; message: string; retry: "load" | "submit"; email?: string }
    | { kind: "confirm"; email: string }
    | { kind: "done"; email: string };

export type ReasonStatus = "idle" | "submitting" | "submitted";
