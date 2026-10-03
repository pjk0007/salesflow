/**
 * 자동 개인화 이메일의 처리 결과 타입과 집계 규칙. DB·네트워크를 모른다.
 *
 * 한 레코드에 여러 규칙(link)이 매칭될 수 있어서 결과가 여러 개 나온다.
 * 큐 워커는 그 여러 개를 하나의 상태로 접어야 하는데, 그 접는 규칙이 여기 있다.
 */

import type { SlotDeferReason } from "@/lib/email-sender-limit-rules";

/** 규칙 하나를 처리한 결과 */
export type LinkOutcome =
    /** 실제로 발송했다 */
    | { kind: "sent"; linkId: number }
    /** 보내지 않는 게 정상인 경우 — 재시도해도 결과가 같다 */
    | { kind: "skipped"; linkId: number; reason: SkipReason }
    /** 실패했다 — 재시도하면 성공할 수 있다 */
    | { kind: "failed"; linkId: number; error: string }
    /** 발신 주소 한도·시간대에 막혀 retryAt까지 미뤘다 — 실패가 아니므로 시도 횟수를 쓰지 않는다 */
    | { kind: "deferred"; linkId: number; retryAt: Date; reason: SlotDeferReason };

export type SkipReason =
    | "condition_not_met"
    | "cooldown"
    | "duplicate_recipient"
    | "invalid_email"
    | "workspace_not_found"
    | "unsubscribed"
    | "no_ai_client"
    | "quota_exceeded"
    | "no_email_client"
    | "no_sender"
    /** 대기열 줄에서 이 규칙이 시도 횟수를 다 써 빠졌다 — 돌리지 않았다 (email-send-queue-rules.ts planQueueRow) */
    | "retry_exhausted";

/** 레코드 하나에 대한 전체 결과 */
export interface RecordOutcome {
    /** 매칭된 규칙이 하나도 없었다 */
    noMatchingRules: boolean;
    outcomes: LinkOutcome[];
}

export type QueueOutcome = "ok" | "skip" | "error" | "defer";

/**
 * 규칙별 결과를 큐 상태 하나로 접는다.
 *
 * 우선순위: 미매칭 → skip, 실패 → error, 미룸 → defer, 발송 → ok, 그 밖 → skip.
 * 발송이 하나라도 있어도 error를 우선한다 — 나머지 규칙을 재시도해야 하고,
 * 이미 보낸 건은 쿨다운(checkCooldown)이 중복 발송을 막는다.
 * 실패가 미룸보다 앞인 것도 같은 이유다 — 실패한 규칙은 미룬 시각까지 기다릴 까닭이 없다.
 * 대신 대기열은 error여도 deferredUntil을 함께 본다 — 시도를 다 쓴 실패 규칙만 빼고 미룬 규칙은 retryAt에
 * 다시 시도한다 (email-send-queue-rules.ts planQueueRow). error만 보고 failed로 닫으면 미룬 메일이 사라진다.
 * 미룸이 발송보다 앞이어야 미룬 규칙이 sent로 닫혀 사라지지 않는다.
 */
export function foldOutcome(result: RecordOutcome): QueueOutcome {
    if (result.noMatchingRules) return "skip";
    if (result.outcomes.some((o) => o.kind === "failed")) return "error";
    if (result.outcomes.some((o) => o.kind === "deferred")) return "defer";
    if (result.outcomes.some((o) => o.kind === "sent")) return "ok";
    return "skip";
}

/**
 * 미룬 규칙 중 가장 이른 다시 시도할 시각과 그 이유. 미룬 것이 없으면 null.
 * 실패가 섞여 있어도 돌려준다 — 바로 보내는 경로는 이 값으로 대기열에 넣어야 하고, 대기열은 실패가 섞인 줄의
 * 시도 횟수를 다 썼을 때 실패한 규칙만 빼고 이 시각에 미룬 규칙을 다시 시도한다 (planQueueRow).
 */
export function deferredUntil(result: RecordOutcome): { retryAt: Date; reason: SlotDeferReason } | null {
    if (result.noMatchingRules) return null;
    let earliest: { retryAt: Date; reason: SlotDeferReason } | null = null;
    for (const o of result.outcomes) {
        if (o.kind !== "deferred") continue;
        // 같은 시각이면 앞 규칙의 이유를 남긴다
        if (!earliest || o.retryAt.getTime() < earliest.retryAt.getTime()) {
            earliest = { retryAt: o.retryAt, reason: o.reason };
        }
    }
    // 호출한 쪽이 고쳐도 결과 객체의 시각이 바뀌지 않게 새 Date로 준다
    return earliest ? { retryAt: new Date(earliest.retryAt.getTime()), reason: earliest.reason } : null;
}

/** 이번에 실패한 규칙 id (결과 순서, 중복 없음). 대기열이 시도 횟수를 다 쓴 규칙을 줄에서 뺄 때 쓴다 */
export function failedLinkIds(result: RecordOutcome): number[] {
    const ids = new Set<number>();
    for (const o of result.outcomes) {
        if (o.kind === "failed") ids.add(o.linkId);
    }
    return [...ids];
}

/** 큐의 last_error에 남길 사람이 읽을 수 있는 요약 */
export function describeOutcome(result: RecordOutcome): string {
    if (result.noMatchingRules) return "no matching rules";
    if (result.outcomes.length === 0) return "no outcomes";
    return result.outcomes
        .map((o) => {
            if (o.kind === "sent") return `link ${o.linkId}: sent`;
            if (o.kind === "skipped") return `link ${o.linkId}: skipped (${o.reason})`;
            if (o.kind === "deferred") {
                return `link ${o.linkId}: deferred (${o.reason}) until ${o.retryAt.toISOString()}`;
            }
            return `link ${o.linkId}: failed (${o.error})`;
        })
        .join("; ");
}
