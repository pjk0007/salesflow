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
    | "copy_cancelled"
    | "experiment_excluded"
    | "no_email_client"
    | "no_sender"
    /** 대기열 줄에서 이 규칙이 시도 횟수를 다 써 빠졌다 — 돌리지 않았다 (email-send-queue-rules.ts planQueueRow) */
    | "retry_exhausted"
    /** 보내기 직전 막기: 이 사업에서 회신한 주소 (DESIGN-RPL 7-4) */
    | "replied"
    /** 보내기 직전 막기: 이 조직에서 hard 반송된 주소 (DESIGN-RPL 7-4) */
    | "bounced"
    /** 요청 결과가 불명확하거나 이미 다른 워커가 선점한 예약은 자동 재전송하지 않는다. */
    | "delivery_uncertain";

/** 레코드 하나에 대한 전체 결과 */
export interface RecordOutcome {
    /** 매칭된 규칙이 하나도 없었다 */
    noMatchingRules: boolean;
    outcomes: LinkOutcome[];
    /**
     * 명단 보류 중이라 규칙을 하나도 돌리지 않았다 (DESIGN-SND 6-2, 대량만). 대기열 줄은 held로 두고 시도 횟수를 쓰지 않는다 —
     * 보류가 풀리면 pending으로 돌아가 원래 순서대로 나간다
     */
    held?: { holdId: number } | { waitReason: QueueWaitReason };
}

/**
 * 대기열 줄을 명단 보류와 같은 held로 두고, 까닭이 풀리면 워커가 되살리는 경우 (UX-228·259).
 *   rules_inactive  파티션·트리거에 규칙은 있으나 모두 꺼졌거나 임시저장 — 규칙을 켜면 이어서 보낸다 (삭제됐으면 닫는다)
 *   quota_exceeded  조직의 월 AI 사용량 한도 — 한도가 풀리면(다음 달·플랜 상향) 이어서 보낸다
 */
export type QueueWaitReason = "rules_inactive" | "quota_exceeded";

/** held 줄의 last_error 앞머리. 되살리기(partition-hold.ts reviveOrphanHeldRows)가 이 앞머리로 조건을 고른다 */
export const QUEUE_WAIT_PREFIX: Record<QueueWaitReason, string> = {
    rules_inactive: "held(rules_inactive)",
    quota_exceeded: "held(quota_exceeded)",
};

/** held 줄의 last_error — 앞머리 + 사람이 읽는 한국어 사유 */
export function describeQueueWait(reason: QueueWaitReason): string {
    return reason === "rules_inactive"
        ? `${QUEUE_WAIT_PREFIX.rules_inactive}: 켜진 AI 자동발송 규칙이 없어 보류 — 규칙을 다시 켜면 이어서 보냅니다`
        : `${QUEUE_WAIT_PREFIX.quota_exceeded}: 이번 달 AI 사용량 한도에 닿아 보류 — 한도가 풀리면 이어서 보냅니다`;
}

/** hold = 명단 보류 (대기열 줄을 held로) */
export type QueueOutcome = "ok" | "skip" | "error" | "defer" | "hold";

/**
 * 규칙별 결과를 큐 상태 하나로 접는다.
 *
 * 우선순위: 미매칭 → skip, 명단 보류·규칙 꺼짐·AI 한도 → hold, 실패 → error, 미룸 → defer, 발송 → ok, 그 밖 → skip.
 * 보류는 규칙을 하나도 돌리지 않았으므로 다른 결과와 섞이지 않는다 (DESIGN-SND 6-2).
 * 발송이 하나라도 있어도 error를 우선한다 — 나머지 규칙을 재시도해야 하고,
 * 이미 보낸 건은 쿨다운(checkCooldown)이 중복 발송을 막는다.
 * 실패가 미룸보다 앞인 것도 같은 이유다 — 실패한 규칙은 미룬 시각까지 기다릴 까닭이 없다.
 * 대신 대기열은 error여도 deferredUntil을 함께 본다 — 시도를 다 쓴 실패 규칙만 빼고 미룬 규칙은 retryAt에
 * 다시 시도한다 (email-send-queue-rules.ts planQueueRow). error만 보고 failed로 닫으면 미룬 메일이 사라진다.
 * 미룸이 발송보다 앞이어야 미룬 규칙이 sent로 닫혀 사라지지 않는다.
 */
export function foldOutcome(result: RecordOutcome): QueueOutcome {
    if (result.noMatchingRules) return "skip";
    if (result.held) return "hold";
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
    if (result.held) {
        return "waitReason" in result.held
            ? describeQueueWait(result.held.waitReason)
            : `partition held (hold ${result.held.holdId})`;
    }
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
