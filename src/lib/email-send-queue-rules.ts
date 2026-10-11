/**
 * 발송 큐의 순수 판정 로직. DB를 모른다.
 *
 * 워커(email-send-queue.ts)와 분리한 이유: @/lib/db를 import하면 모듈 로드 시점에
 * postgres 커넥션이 생겨 테스트 러너가 종료되지 않는다.
 */

/** 실패 재시도 상한. 초과하면 failed로 확정한다. */
export const MAX_ATTEMPTS = 3;

/** processing에 이만큼 머물면 죽은 것으로 보고 회수한다. 워커 상한(8분)보다 넉넉해야 한다. */
export const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

/** 한 회차의 처리 예산. cron 주기(10분) 안에 여유를 남긴다. */
export const DEADLINE_BUDGET_MS = 8 * 60 * 1000;

export type ProcessOutcome = "ok" | "skip" | "error";
export type QueueStatus = "pending" | "processing" | "sent" | "skipped" | "failed";

/**
 * 처리 결과와 누적 시도 횟수로 다음 상태를 정한다.
 *
 * attempts는 픽업 시점에 이미 증가된 값이다 — 처리 중 프로세스가 죽어도
 * 시도가 기록되어야 무한 재시도를 막을 수 있다.
 */
export function nextStatus(
    outcome: ProcessOutcome,
    attempts: number,
    maxAttempts: number = MAX_ATTEMPTS
): QueueStatus {
    if (outcome === "ok") return "sent";
    // 규칙 미매칭·쿨다운·중복수신자·구독취소는 실패가 아니다. 재시도해도 같은 결과다.
    if (outcome === "skip") return "skipped";
    return attempts >= maxAttempts ? "failed" : "pending";
}

/** processing 상태로 방치된 행인지 판정한다. */
export function isStuck(
    lockedAt: Date | null,
    now: Date,
    thresholdMs: number = STUCK_THRESHOLD_MS
): boolean {
    if (lockedAt === null) return false;
    const elapsed = now.getTime() - lockedAt.getTime();
    // 시계 역전(음수)도 여기서 걸러진다 — 멀쩡한 행을 회수하지 않는다
    return elapsed > thresholdMs;
}

/** 이번 회차의 처리 예산을 다 썼는지 판정한다. */
export function isDeadlineExceeded(
    startedAtMs: number,
    nowMs: number,
    budgetMs: number = DEADLINE_BUDGET_MS
): boolean {
    return nowMs - startedAtMs >= budgetMs;
}
