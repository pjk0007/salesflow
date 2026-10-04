/**
 * 발송 큐의 순수 판정 로직. DB를 모른다.
 *
 * 워커(email-send-queue.ts)와 분리한 이유: @/lib/db를 import하면 모듈 로드 시점에
 * postgres 커넥션이 생겨 테스트 러너가 종료되지 않는다.
 */

import { foldOutcome, deferredUntil, describeOutcome, failedLinkIds } from "@/lib/auto-personalized-email-outcome";
import type { LinkOutcome, RecordOutcome } from "@/lib/auto-personalized-email-outcome";
import { describeDeferral, linkSenderPool } from "@/lib/email-sender-limit-rules";
import type { SendPurpose, SlotDeferReason } from "@/lib/email-sender-limit-rules";
import { formatKstShort, kstParts } from "@/lib/kst";

/** 실패 재시도 상한. 초과하면 failed로 확정한다. */
export const MAX_ATTEMPTS = 3;

/** processing에 이만큼 머물면 죽은 것으로 보고 회수한다. 워커 상한(8분)보다 넉넉해야 한다. */
export const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

/** 한 회차의 처리 예산. cron 주기(10분) 안에 여유를 남긴다. */
export const DEADLINE_BUDGET_MS = 8 * 60 * 1000;

/** defer = 발신 주소 한도·시간대에 막혀 미뤘다 (실패 아님) */
export type ProcessOutcome = "ok" | "skip" | "error" | "defer";
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
    // 미룸은 시도 횟수와 상관없이 다시 기다린다 — 한도는 실패가 아니라서 failed로 닫으면 메일이 사라진다.
    // 꺼낼 때 올린 attempts는 워커가 되돌리고, 언제 다시 꺼낼지는 scheduled_at(retryAt)이 정한다.
    if (outcome === "defer") return "pending";
    return attempts >= maxAttempts ? "failed" : "pending";
}

/**
 * 줄 하나를 처리한 뒤 그 줄에 쓸 값. 워커(email-send-queue.ts applyPlan)가 그대로 UPDATE한다.
 * attempts는 꺼낼 때 올린 값을 기준으로 한 절대값이다 — 처리 중인 줄은 다른 곳이 attempts를 바꾸지 않는다.
 */
export interface QueueRowPlan {
    status: Exclude<QueueStatus, "processing">;
    attempts: number;
    /** 다시 꺼낼 시각. null이면 scheduled_at을 그대로 둔다 (실패 재시도는 같은 회차에 바로 다시 꺼낸다) */
    scheduledAt: Date | null;
    /** 시도 횟수를 다 써 이 줄에서 빼 둔 규칙 id. 다음에 꺼낼 때 그 규칙은 돌리지 않는다 */
    exhaustedLinkIds: number[];
    /** 회차 통계에 셀 칸 */
    stat: "sent" | "skipped" | "failed" | "requeued" | "deferred";
}

export interface QueueRowResult {
    outcome: ProcessOutcome;
    /** 꺼낼 때 올린 뒤의 시도 횟수 */
    attempts: number;
    /** 미룬 규칙이 있으면 그중 가장 이른 다시 시도할 시각. 실패가 섞여 있어도 준다 */
    deferral: { retryAt: Date } | null;
    /** 이번 시도에서 실패한 규칙 id */
    failedLinkIds: readonly number[];
    /** 이미 시도 횟수를 다 써 빼 둔 규칙 id (이번에 돌리지 않았다) */
    exhaustedLinkIds: readonly number[];
}

/**
 * 처리 결과로 줄을 어떻게 남길지 정한다.
 *
 *   발송(ok)          sent
 *   보낼 것 없음(skip) skipped. 단 시도 횟수를 다 써 빼 둔 규칙이 있으면 failed — 그 규칙은 끝내 실패했다
 *   미룸(defer)       pending, scheduled_at = retryAt, 꺼낼 때 올린 시도 1을 되돌린다 (W14 — 한도는 실패가 아니다)
 *   실패(error)       시도가 남았으면 pending으로 같은 회차에 바로 다시, 다 썼으면 failed (B6)
 *
 * 실패와 미룸이 함께 나온 줄(앞 규칙 실패 + 뒤 규칙 한도): 시도가 남았으면 보통 실패처럼 바로 다시 시도한다 —
 * 앞 규칙의 재시도는 뒤 규칙의 한도와 상관없다. 시도를 다 쓰면 failed로 닫지 않는다. 닫으면 미룬 규칙의 메일이
 * 사라진다. 대신 실패한 규칙을 이 줄에서 빼고(exhaustedLinkIds) 시도 횟수를 0으로 되돌려, retryAt에 남은 규칙만
 * 다시 시도한다. 빼 둔 규칙은 다시 돌리지 않으므로 그 규칙의 비용(AI 생성·NHN 호출)은 처음 3번으로 끝난다.
 * 새로 뺄 규칙이 없으면(이미 다 뺐다) failed로 닫는다 — 규칙 수만큼만 되풀이되고 끝난다.
 */
export function planQueueRow(input: QueueRowResult, maxAttempts: number = MAX_ATTEMPTS): QueueRowPlan {
    const { outcome, attempts, deferral, failedLinkIds } = input;
    const exhausted = [...input.exhaustedLinkIds];

    if (outcome === "ok") {
        return { status: "sent", attempts, scheduledAt: null, exhaustedLinkIds: exhausted, stat: "sent" };
    }
    if (outcome === "skip") {
        const status = exhausted.length > 0 ? "failed" : "skipped";
        return { status, attempts, scheduledAt: null, exhaustedLinkIds: exhausted, stat: status };
    }
    if (outcome === "defer" && deferral) {
        return {
            status: "pending",
            attempts: Math.max(attempts - 1, 0),
            scheduledAt: new Date(deferral.retryAt.getTime()),
            exhaustedLinkIds: exhausted,
            stat: "deferred",
        };
    }

    // error (미룸인데 시각이 없는 것도 여기로 — scheduled_at을 못 옮기므로 실패로 보고 시도 횟수를 쓴다)
    if (nextStatus("error", attempts, maxAttempts) === "pending") {
        return { status: "pending", attempts, scheduledAt: null, exhaustedLinkIds: exhausted, stat: "requeued" };
    }
    if (deferral) {
        const added = failedLinkIds.filter((id) => !exhausted.includes(id));
        if (added.length > 0) {
            return {
                status: "pending",
                attempts: 0,
                scheduledAt: new Date(deferral.retryAt.getTime()),
                exhaustedLinkIds: [...exhausted, ...new Set(added)],
                stat: "deferred",
            };
        }
    }
    return { status: "failed", attempts, scheduledAt: null, exhaustedLinkIds: exhausted, stat: "failed" };
}

/**
 * 처리하는 사이 바로 보내는 경로가 "다시 처리" 요청(requeue_at)을 남겼을 때, 이 결과로 줄을 끝내지 않고 다시 꺼낼까.
 *   skipped·failed → 다시 꺼낸다. 워커는 고치기 전 레코드를 읽었을 수 있다 — 그대로 끝내면 고친 뒤 미룬 메일이 사라진다
 *   sent           → 다시 꺼내지 않는다. 쿨다운(1시간)이 원래 막았을 두 번째 메일이 나중에 나가지 않게
 *   pending        → 어차피 다시 꺼낸다 (둘 중 이른 시각에). 꺼낼 때 최신 레코드를 읽는다
 */
export function revivesOnRequeue(status: QueueRowPlan["status"]): boolean {
    return status === "skipped" || status === "failed";
}

/** DB의 exhausted_link_ids(jsonb)를 읽는다. 배열이 아니거나 이상한 값은 버린다 */
export function parseLinkIdList(value: unknown): number[] {
    let v = value;
    if (typeof v === "string") {
        try {
            v = JSON.parse(v);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(v)) return [];
    const ids = new Set<number>();
    for (const x of v) {
        if (typeof x === "number" && Number.isSafeInteger(x) && x > 0) ids.add(x);
    }
    return [...ids];
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

// ============================================
// 줄 우선순위 — 문의는 바로, 대량 명단은 줄 세우기 (DESIGN-2 2절)
// ============================================

/** 대량 명단 줄 (가져오기·예약 등록 → enqueueSends). 칸 기본값이다 */
export const QUEUE_PRIORITY_BULK = 0;
/**
 * 문의(한 건씩 생긴 레코드)가 발신 한도에 막혀 들어온 줄 (enqueueDeferredSend).
 * 꺼낼 때 먼저다 (ORDER BY priority DESC, scheduled_at, id) — 같은 때 열리면 문의가 대량 명단보다 앞선다
 */
export const QUEUE_PRIORITY_INBOUND = 1;

/**
 * 대기열 줄의 priority → 자리 잡을 때의 발송 목적. 1 이상이면 문의(그날 한도 전체), 아니면 대량(15:00 전까지 문의 몫을 남긴다).
 * 이상한 값(null·문자열)은 대량으로 본다 — 칸 기본값이 0이다.
 */
export function purposeOfQueuePriority(priority: unknown): SendPurpose {
    const n = typeof priority === "number" ? priority : typeof priority === "string" ? Number(priority) : NaN;
    return Number.isFinite(n) && n >= QUEUE_PRIORITY_INBOUND ? "inbound" : "bulk";
}

/**
 * 새 대량 줄의 선입선출 하한을 정할 때 세는 미룸 이유 (last_error "deferred(이유) until …").
 * 그날 한도·시간대·정지로 막혀 "다음에 열리는 날 시작"을 기다리는 줄만 센다. 간격(spacing) 미룸은 그날 안에 펼쳐져 있고
 * 새 줄도 꺼내자마자 그 뒤로 펼쳐지므로 세지 않는다.
 */
export const FIFO_FLOOR_DEFER_REASONS: readonly SlotDeferReason[] = ["daily_limit", "outside_window", "paused"];

/**
 * 새로 넣는 대량 줄(enqueueSends)의 예정 시각 — 대량 명단은 먼저 들어온 순으로 나간다 (DESIGN-2 Q4).
 *
 * deferredUntil = 같은 규칙 묶음(조직·파티션·트리거)에서 한도·시간대·정지로 미뤄 둔 대량 줄(FIFO_FLOOR_DEFER_REASONS) 중
 * 오늘(KST) 다시 열리는 가장 늦은 예정 시각 (없으면 null). 새 줄은 그보다 일찍 꺼내지 않는다.
 * 막으려는 것: 시간대를 정하지 않은 주소는 한도를 다 쓴 날의 남은 줄을 다음 날 09:00(DEFAULT_RESUME_HOUR)으로 미루는데,
 * 그 사이(00:00~09:00)에 들어온 새 줄은 그날 한도가 새로 열려 바로 나가 어제 밀린 줄을 앞질렀다.
 *
 * 하한은 deferredUntil이 오늘 날짜일 때만 건다 — 미룬 줄이 내일 이후에 열리면 새 줄도 꺼내자마자 같은 이유로 같은 시각에
 * 미뤄지므로(먼저 들어온 순 그대로) 하한이 필요 없다. 그때 새 줄이 바로 나간다면 막힌 이유가 그 사이 풀렸거나(한도를 올림·
 * 정지를 풂·주소를 더함) 다른 규칙·다른 묶음으로 가는 줄이다 — 하루 가까이 묶어 두면 안 된다 (REVIEW-2 안전 F1).
 * 규칙마다 묶음이 다른 파티션은 부르는 쪽이 deferredUntil을 null로 넘긴다 (sharesOneSenderPool).
 *
 * 돌려주는 값: 넣을 예정 시각. null이면 칸 기본값(지금)을 그대로 쓴다. requested(호출한 쪽이 정한 시각)보다 당기지 않는다.
 */
export function bulkFifoScheduledAt(requested: Date | null, now: Date, deferredUntil: Date | null): Date | null {
    const base = requested ?? now;
    if (
        deferredUntil &&
        deferredUntil.getTime() > base.getTime() &&
        kstParts(deferredUntil).date === kstParts(now).date
    ) {
        return new Date(deferredUntil.getTime());
    }
    return requested ? new Date(requested.getTime()) : null;
}

/**
 * 파티션·트리거의 켜진 AI 규칙이 모두 같은 발신 묶음(주소 집합)을 쓰는가. 규칙이 없거나 하나면 true.
 * 묶음이 다르면 미뤄 둔 줄이 막힌 묶음과 새 레코드가 갈 묶음이 다를 수 있다 — 선입선출 하한(bulkFifoScheduledAt)을 걸지 않는다.
 * 묶음이 비어 있는 규칙(기본 주소로 보냄)끼리는 같은 묶음으로 본다.
 */
export function sharesOneSenderPool(
    links: ReadonlyArray<{ senderProfileId: number | null; senderProfileIds: unknown }>
): boolean {
    const keys = new Set(
        links.map((l) =>
            linkSenderPool({
                senderProfileId: l.senderProfileId,
                senderProfileIds: Array.isArray(l.senderProfileIds) ? (l.senderProfileIds as number[]) : null,
            })
                .slice()
                .sort((a, b) => a - b)
                .join(",")
        )
    );
    return keys.size <= 1;
}

// ============================================
// 배치 안 자리 잡기 차례 (DESIGN-2 1절·Q1·Q4·Q5)
// ============================================

/**
 * 한 배치 안 자리 잡기 차례: 문의 먼저(priority DESC), 그다음 먼저 들어온 순(id). 새 배열을 준다.
 *
 * - pickBatch의 UPDATE … RETURNING은 하위 쿼리의 ORDER BY와 상관없이 표에 놓인 순서로 줄을 돌려준다 — 그대로 차례를 매기면
 *   마지막 한 칸을 늦게 들어온 줄이 가져갔다 (재검증 S2: s2-06 대신 s2-10). 그래서 다시 줄 세운다.
 * - 배치에 든 줄은 모두 꺼낼 때가 된 줄이다. 그 안에서는 예정 시각(scheduled_at)이 아니라 들어온 순으로 세운다 —
 *   고르게 나눠 보내기에서 앞 칸을 문의에 내준 대량 줄은 "마지막 발송 + 간격"으로 다시 미뤄져, 미리 펼쳐 둔 다음 줄의 칸보다
 *   몇 분 늦은 시각을 받는다. 예정 시각 순이면 그 줄이 칸마다 다음 줄에 밀려 하루 끝까지 처진다 (재검증 S7).
 *   어느 줄을 꺼낼지는 여전히 pickBatch가 priority DESC, scheduled_at, id로 정한다 (색인 순서).
 */
export function sortPickedRows<T extends { id: number; priority: unknown }>(rows: readonly T[]): T[] {
    const prio = (v: unknown) => {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) ? n : QUEUE_PRIORITY_BULK;
    };
    return [...rows].sort((a, b) => prio(b.priority) - prio(a.priority) || Number(a.id) - Number(b.id));
}

/** 줄 하나의 자리 잡기 차례 (createClaimTurns) */
export interface ClaimTurn {
    /** 차례가 오면 claim(발신 자리 잡기)을 돌린다. 자리 잡기는 언제나 한 번에 하나다 */
    run<T>(claim: () => Promise<T>): Promise<T>;
    /** 이 줄의 처리가 끝났다 — 아직 자리를 잡지 않았으면 뒤 줄에 차례를 넘긴다. 여러 번 불러도 된다 */
    done(): void;
}

/**
 * 대기열 워커가 함께 처리하는 줄(배치)의 발신 자리 잡기를 꺼낸 순서대로 하나씩 하게 한다.
 * AI 생성·NHN 호출은 그대로 겹쳐 돌고, 그 앞의 자리 잡기(claimSender)만 줄을 세운다.
 *
 * 함께 잡으면 생기던 일 (REVIEW-2 정책 F1, 검증 S1 실패):
 *   - 다섯 줄이 같은 순간의 사용량을 읽어 모두 같은 "가장 오래 쉰 주소"를 고른다 — 묶음이 돌아가지 않고 한 주소에 몰린다
 *   - 한도·문의 몫·간격의 마지막 한 칸을 꺼낸 순서(문의 먼저, 먼저 들어온 순)가 아니라 먼저 닿은 줄이 가져간다
 *   - 간격 미룸 펼치기의 순번이 꺼낸 순서가 아니라 끝난 순서로 매겨진다
 *
 * 줄 i의 첫 자리 잡기는 앞 줄(0..i-1)이 모두 첫 자리 잡기를 마쳤거나 처리를 끝낸(done) 뒤에 한다.
 * 한 줄이 규칙 여럿으로 두 번째 자리를 잡을 때도 한 번에 하나씩이다 — 앞 자리 잡기가 쓴 사용량을 다음 자리 잡기가 읽는다.
 * 부르는 쪽은 줄마다 처리가 끝나면(보냈든 건너뛰었든 던졌든) 반드시 done()을 불러야 한다 — 안 부르면 뒤 줄이 기다린다.
 */
export function createClaimTurns(count: number): ClaimTurn[] {
    const n = Math.max(0, Math.floor(count));
    const release: Array<() => void> = [];
    const turnEnded: Array<Promise<void>> = [];
    for (let i = 0; i < n; i++) {
        turnEnded.push(new Promise<void>((resolve) => release.push(resolve)));
    }

    // 자리 잡기 한 번에 하나 — 앞 자리 잡기가 끝나야(성공·실패 상관없이) 다음이 돈다
    let tail: Promise<void> = Promise.resolve();
    const exclusive = <T>(claim: () => Promise<T>): Promise<T> => {
        const result = tail.then(claim);
        tail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    };

    return turnEnded.map((_, i) => {
        let ended = false;
        const end = () => {
            if (ended) return;
            ended = true;
            release[i]();
        };
        const before = Promise.all(turnEnded.slice(0, i));
        return {
            async run<T>(claim: () => Promise<T>): Promise<T> {
                if (!ended) await before;
                try {
                    return await exclusive(claim);
                } finally {
                    end();
                }
            },
            done: end,
        };
    });
}

/** 이번 회차의 처리 예산을 다 썼는지 판정한다. */
export function isDeadlineExceeded(
    startedAtMs: number,
    nowMs: number,
    budgetMs: number = DEADLINE_BUDGET_MS
): boolean {
    return nowMs - startedAtMs >= budgetMs;
}

// ============================================
// 줄 하나의 처리 결과 → 줄에 쓸 값 (줄마다 처리·묶어 미루기가 같이 쓴다)
// ============================================

/** 줄 하나를 처리한 결과 (processAutoPersonalizedEmail 결과를 접은 것) */
export interface ProcessedRow {
    outcome: ProcessOutcome;
    detail: string;
    /** 미룬 규칙이 있으면 가장 이른 다시 시도할 시각과 이유 — 실패가 섞여 있어도 준다 (planQueueRow가 쓴다) */
    deferral: { retryAt: Date; reason: SlotDeferReason } | null;
    /** 이번에 실패한 규칙 id */
    failedLinkIds: number[];
}

/** 레코드가 지워졌으면 보낼 대상이 없다 — 실패가 아니므로 재시도하지 않는다 */
export function recordDeletedRow(): ProcessedRow {
    return { outcome: "skip", detail: "record deleted", deferral: null, failedLinkIds: [] };
}

/** 규칙별 결과를 줄 하나의 처리 결과로 접는다 */
export function toProcessedRow(result: RecordOutcome): ProcessedRow {
    const outcome = foldOutcome(result);
    // 실패가 섞여도 미룬 시각을 넘긴다 — error로 접힌 줄도 미룬 규칙을 잃지 않게 planQueueRow가 쓴다
    const deferral = deferredUntil(result);
    const detail = describeOutcome(result);
    // defer인데 시각이 없으면 scheduled_at을 못 옮겨 같은 회차에 바로 다시 꺼내진다 — 실패로 보고 시도 횟수를 쓴다
    if (outcome === "defer" && !deferral) {
        return { outcome: "error", detail, deferral: null, failedLinkIds: failedLinkIds(result) };
    }
    return { outcome, detail, deferral, failedLinkIds: failedLinkIds(result) };
}

/** last_error에 남길 문구. 순수 미룸은 예전처럼 짧게, 실패한 규칙을 뺀 줄은 무엇을 뺐는지 앞에 적는다 */
export function describePlan(plan: QueueRowPlan, processed: ProcessedRow, exhaustedBefore: readonly number[]): string {
    if (processed.outcome === "defer" && plan.stat === "deferred" && processed.deferral) {
        return describeDeferral(processed.deferral.reason, processed.deferral.retryAt);
    }
    const added = plan.exhaustedLinkIds.filter((id) => !exhaustedBefore.includes(id));
    if (added.length > 0 && plan.scheduledAt) {
        return `retry exhausted: link ${added.join(",")} (not run again), rest at ${formatKstShort(plan.scheduledAt)} KST; ${processed.detail}`;
    }
    return processed.detail;
}

/**
 * 줄 하나에 쓸 값. 워커(applyPlans)가 여러 줄을 jsonb_to_recordset으로 한 문장에 쓴다 — 칸 이름은 그 SQL의 v(...)와 같다.
 * 예전 applyPlan이 줄마다 매개변수로 넘기던 값과 같다 (상태·시도·다시 꺼낼 시각·뺀 규칙·되살릴지·pending인지·문구).
 *
 * stamp_lock: 꺼내지(pickBatch) 않고 처리한 줄(묶어 미루기)이다. 끝낸 줄(skipped·failed)의 locked_at을, 꺼냈다면
 * 남았을 값(지금)으로 채운다 — 줄마다 처리한 줄과 같은 모양으로 남게.
 */
export interface QueueRowWrite {
    id: number;
    status: QueueRowPlan["status"];
    attempts: number;
    scheduled_at: string | null;
    exhausted: number[] | null;
    revivable: boolean;
    pending: boolean;
    last_error: string | null;
    stamp_lock: boolean;
}

export function toQueueRowWrite(
    id: number,
    plan: QueueRowPlan,
    detail: string,
    opts: { stampLock: boolean } = { stampLock: false }
): QueueRowWrite {
    return {
        id,
        status: plan.status,
        attempts: plan.attempts,
        scheduled_at: plan.scheduledAt ? plan.scheduledAt.toISOString() : null,
        exhausted: plan.exhaustedLinkIds.length > 0 ? [...plan.exhaustedLinkIds] : null,
        revivable: revivesOnRequeue(plan.status),
        pending: plan.status === "pending",
        last_error: plan.status === "sent" ? null : toWellFormed(detail.slice(0, 2000)),
        stamp_lock: opts.stampLock,
    };
}

/**
 * 짝 없는 서로게이트를 U+FFFD로 바꾼다. 예전에는 문구를 text 매개변수로 넘겨 드라이버가 UTF-8로 바꾸며 이렇게 됐다.
 * 이제 JSON(jsonb)으로 넘기는데 jsonb는 짝 없는 \uD800 같은 이스케이프를 거부한다 — 2000자에서 잘린 이모지 하나로
 * 여러 줄 쓰기가 통째로 실패하지 않게, 예전에 저장되던 값으로 미리 바꾼다
 */
export function toWellFormed(text: string): string {
    return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

// ============================================
// 막힌 묶음의 줄을 한꺼번에 미루기 (발송 대기열 워커)
// ============================================

/**
 * 한 번에 묶어 처리하는 줄 수 상한. 미루기·건너뛰기는 NHN·AI를 부르지 않으므로 발송 배치(5건·1초 쉼)와 상관없다.
 * 한 번 처리의 조회 수는 줄 수와 거의 상관없다 (규칙·쿨다운·수신거부·주소와 사용량을 묶음마다 한 번씩).
 */
export const DRAIN_BATCH_SIZE = 200;

/**
 * 같은 규칙 목록을 보는 줄 (같은 조직·파티션·트리거) — processAutoPersonalizedEmail의 규칙 조회 조건이 같다.
 * priority도 나눈다 — 문의 줄과 대량 줄은 쓸 수 있는 한도가 달라(문의 몫) 한쪽이 막혀도 다른 쪽은 열려 있을 수 있다.
 * priority가 없으면 대량(0)으로 본다.
 */
export function drainGroupKey(row: {
    org_id: string;
    partition_id: number;
    trigger_type: string;
    priority?: number | null;
}): string {
    return `${row.org_id}|${row.partition_id}|${row.trigger_type}|${row.priority ?? QUEUE_PRIORITY_BULK}`;
}

/** walkQueueRow가 보는 AI 규칙 칸 (email_auto_personalized_links의 일부) */
export interface QueueWalkLink {
    id: number;
    recipientField: string;
    preventDuplicate: number;
    model: string | null;
}

/**
 * walkQueueRow에 넘기는 조회 결과. 묶음 전체를 한 번씩 읽어 둔 값이다.
 * undefined = 아직 읽지 않았다 → walkQueueRow가 { kind: "need" }로 무엇을 읽을지 알린다 (원래 흐름에서 그 조회를 하는 자리에 닿았을 때만)
 */
export interface QueueWalkLookups {
    /** evaluateCondition(link.triggerCondition, data). 던지면 그 줄은 줄마다 처리한다 */
    conditionMet: (link: QueueWalkLink) => boolean;
    /** 같은 레코드에 1시간 안 AI 발송 이력이 있다 (checkCooldown이 false) */
    cooldownActive: boolean;
    /** 같은 파티션·같은 받는 주소로 AI 자동 발송을 보낸 적이 있다 (checkDuplicateRecipientForAiAuto가 false). 모르면 undefined */
    isDuplicate: (email: string) => boolean | undefined;
    /** 파티션의 워크스페이스 (resolveWorkspaceId) */
    workspaceId: number | null;
    /** isUnsubscribed(workspaceId, email). 모르면 undefined */
    isUnsubscribed: (email: string) => boolean | undefined;
    /** getAiClient(model)가 null이 아니다 */
    aiClientReady: (model: string | undefined) => boolean;
    /** checkTokenQuota(orgId).allowed */
    quotaAllowed: boolean | undefined;
    /** getEmailClient(orgId)가 null이 아니다 */
    emailClientReady: boolean | undefined;
    /** 이 규칙의 발신 주소 묶음이 지금 막혔나 (checkPoolsBlocked) */
    poolBlock: (link: QueueWalkLink) => { blocked: true; reason: SlotDeferReason } | { blocked: false } | undefined;
}

export type QueueWalk =
    /** 규칙을 모두 건너뛰었다(또는 규칙이 없다) — 이 결과로 줄을 닫는다 */
    | { kind: "skip"; result: RecordOutcome }
    /** 앞 규칙들은 건너뛰고(skipped) linkId 규칙이 막힌 묶음에서 미뤄진다. retryAt은 부른 쪽이 줄 순서대로 채운다 */
    | { kind: "defer"; skipped: LinkOutcome[]; linkId: number; reason: SlotDeferReason }
    /** 이 값을 읽어야 이어 갈 수 있다 (원래 흐름에서 그 조회를 하는 자리에 닿았다) */
    | { kind: "need"; need: "quota" | "emailClient" | "pool" }
    /** 묶어서 판단하지 않는다 — 줄마다 processAutoPersonalizedEmail로 처리한다 (보낼 수 있다·판단할 수 없는 값) */
    | { kind: "process"; why: string };

/**
 * 대기열 줄 하나를 processAutoPersonalizedEmail과 같은 순서·같은 조건으로 따라가되, 자리를 잡거나 보내야 하는 지점에
 * 닿으면 멈춘다. 결과가 skip·defer면 그 줄을 processAutoPersonalizedEmail로 처리한 결과(규칙별 결과)와 같다.
 *
 * processAutoPersonalizedEmail (auto-personalized-email.ts)의 규칙 하나마다:
 *   1 시도를 다 써 뺀 규칙 → skipped(retry_exhausted)        5 워크스페이스 없음 → skipped(workspace_not_found)
 *   2 조건 불충족 → skipped(condition_not_met)               6 수신거부 → skipped(unsubscribed)
 *   3 쿨다운 → skipped(cooldown)                             7 AI 클라이언트 없음 → skipped(no_ai_client)
 *   3-1 중복 수신자(preventDuplicate) → skipped(duplicate)    8 토큰 쿼터 → skipped(quota_exceeded)
 *   4 받는 주소가 메일 모양이 아님 → skipped(invalid_email)   9 메일 클라이언트 없음 → skipped(no_email_client)
 *   10 claimSender가 막힘 → deferred, 뒤 규칙은 보지 않는다(break). 막히지 않으면 자리를 잡고 보낸다 → 여기서는 process
 * 그 함수에서 던져 failed가 되는 값(문자열이 아닌 중복 확인 값, 던지는 조건식, 객체가 아닌 data)도 process로 돌린다 —
 * 실패 처리는 그쪽 몫이다. 그 함수의 검사 순서를 바꾸면 여기도 같이 바꿔야 한다 (email-send-queue-rules.test.ts가 순서를 고정한다).
 */
export function walkQueueRow(
    input: { data: unknown; links: readonly QueueWalkLink[]; skipLinkIds: readonly number[] },
    lookups: QueueWalkLookups
): QueueWalk {
    if (input.links.length === 0) return { kind: "skip", result: { noMatchingRules: true, outcomes: [] } };
    if (typeof input.data !== "object" || input.data === null || Array.isArray(input.data)) {
        return { kind: "process", why: "record_data_not_object" };
    }
    const data = input.data as Record<string, unknown>;
    const skip = new Set(input.skipLinkIds);
    const outcomes: LinkOutcome[] = [];

    for (const link of input.links) {
        if (skip.has(link.id)) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "retry_exhausted" });
            continue;
        }
        let met: boolean;
        try {
            met = lookups.conditionMet(link);
        } catch {
            return { kind: "process", why: "condition_throws" };
        }
        if (!met) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "condition_not_met" });
            continue;
        }
        if (lookups.cooldownActive) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "cooldown" });
            continue;
        }
        if (link.preventDuplicate) {
            const recipientEmail = data[link.recipientField];
            if (recipientEmail) {
                if (typeof recipientEmail !== "string") return { kind: "process", why: "recipient_not_string" };
                const duplicate = lookups.isDuplicate(recipientEmail);
                if (duplicate === undefined) return { kind: "process", why: "duplicate_unknown" };
                if (duplicate) {
                    outcomes.push({ kind: "skipped", linkId: link.id, reason: "duplicate_recipient" });
                    continue;
                }
            }
        }
        const email = data[link.recipientField];
        if (!email || typeof email !== "string" || !email.includes("@")) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "invalid_email" });
            continue;
        }
        if (!lookups.workspaceId) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "workspace_not_found" });
            continue;
        }
        const unsubscribed = lookups.isUnsubscribed(email);
        if (unsubscribed === undefined) return { kind: "process", why: "unsubscribe_unknown" };
        if (unsubscribed) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "unsubscribed" });
            continue;
        }
        if (!lookups.aiClientReady(link.model || undefined)) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "no_ai_client" });
            continue;
        }
        if (lookups.quotaAllowed === undefined) return { kind: "need", need: "quota" };
        if (!lookups.quotaAllowed) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "quota_exceeded" });
            continue;
        }
        if (lookups.emailClientReady === undefined) return { kind: "need", need: "emailClient" };
        if (!lookups.emailClientReady) {
            outcomes.push({ kind: "skipped", linkId: link.id, reason: "no_email_client" });
            continue;
        }
        const block = lookups.poolBlock(link);
        if (block === undefined) return { kind: "need", need: "pool" };
        if (!block.blocked) return { kind: "process", why: "sender_open" };
        return { kind: "defer", skipped: outcomes, linkId: link.id, reason: block.reason };
    }
    return { kind: "skip", result: { noMatchingRules: false, outcomes } };
}

/** walkQueueRow의 defer를 규칙별 결과로 바꾼다 — processAutoPersonalizedEmail이 그 규칙에서 미뤘을 때 돌려주는 모양과 같다 */
export function deferredRecordOutcome(
    walk: Extract<QueueWalk, { kind: "defer" }>,
    retryAt: Date
): RecordOutcome {
    return {
        noMatchingRules: false,
        outcomes: [...walk.skipped, { kind: "deferred", linkId: walk.linkId, retryAt, reason: walk.reason }],
    };
}
