/**
 * 자동 개인화 이메일의 처리 결과 타입과 집계 규칙. DB·네트워크를 모른다.
 *
 * 한 레코드에 여러 규칙(link)이 매칭될 수 있어서 결과가 여러 개 나온다.
 * 큐 워커는 그 여러 개를 하나의 상태로 접어야 하는데, 그 접는 규칙이 여기 있다.
 */

/** 규칙 하나를 처리한 결과 */
export type LinkOutcome =
    /** 실제로 발송했다 */
    | { kind: "sent"; linkId: number }
    /** 보내지 않는 게 정상인 경우 — 재시도해도 결과가 같다 */
    | { kind: "skipped"; linkId: number; reason: SkipReason }
    /** 실패했다 — 재시도하면 성공할 수 있다 */
    | { kind: "failed"; linkId: number; error: string };

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
    | "no_sender";

/** 레코드 하나에 대한 전체 결과 */
export interface RecordOutcome {
    /** 매칭된 규칙이 하나도 없었다 */
    noMatchingRules: boolean;
    outcomes: LinkOutcome[];
}

export type QueueOutcome = "ok" | "skip" | "error";

/**
 * 규칙별 결과를 큐 상태 하나로 접는다.
 *
 * 우선순위: 실패가 하나라도 있으면 error다.
 * 발송이 하나라도 있어도 error를 우선한다 — 나머지 규칙을 재시도해야 하고,
 * 이미 보낸 건은 쿨다운(checkCooldown)이 중복 발송을 막는다.
 */
export function foldOutcome(result: RecordOutcome): QueueOutcome {
    if (result.noMatchingRules) return "skip";
    if (result.outcomes.some((o) => o.kind === "failed")) return "error";
    if (result.outcomes.some((o) => o.kind === "sent")) return "ok";
    return "skip";
}

/** 큐의 last_error에 남길 사람이 읽을 수 있는 요약 */
export function describeOutcome(result: RecordOutcome): string {
    if (result.noMatchingRules) return "no matching rules";
    if (result.outcomes.length === 0) return "no outcomes";
    return result.outcomes
        .map((o) => {
            if (o.kind === "sent") return `link ${o.linkId}: sent`;
            if (o.kind === "skipped") return `link ${o.linkId}: skipped (${o.reason})`;
            return `link ${o.linkId}: failed (${o.error})`;
        })
        .join("; ");
}
