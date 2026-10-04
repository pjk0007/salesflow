import { test } from "node:test";
import assert from "node:assert";
import {
    nextStatus,
    isStuck,
    isDeadlineExceeded,
    parseLinkIdList,
    planQueueRow,
    revivesOnRequeue,
    MAX_ATTEMPTS,
    toProcessedRow,
    recordDeletedRow,
    describePlan,
    toQueueRowWrite,
    toWellFormed,
    walkQueueRow,
    deferredRecordOutcome,
    drainGroupKey,
    purposeOfQueuePriority,
    bulkFifoScheduledAt,
    sharesOneSenderPool,
    sortPickedRows,
    createClaimTurns,
    FIFO_FLOOR_DEFER_REASONS,
    QUEUE_PRIORITY_BULK,
    QUEUE_PRIORITY_INBOUND,
    type QueueRowResult,
    type QueueWalkLink,
    type QueueWalkLookups,
} from "./email-send-queue-rules";

// ── nextStatus — B6 ──

test("발송에 성공하면 sent다", () => {
    assert.equal(nextStatus("ok", 1), "sent");
});

test("규칙 미매칭·쿨다운 등은 skipped이며 재시도하지 않는다 (B6)", () => {
    // 실패가 아니므로 attempts를 다 써도 failed가 아니다
    assert.equal(nextStatus("skip", 1), "skipped");
    assert.equal(nextStatus("skip", MAX_ATTEMPTS), "skipped");
});

test("실패했고 시도가 남았으면 pending으로 돌려 재시도한다 (B6)", () => {
    assert.equal(nextStatus("error", 1), "pending");
    assert.equal(nextStatus("error", MAX_ATTEMPTS - 1), "pending");
});

test("실패했고 시도를 다 썼으면 failed로 확정한다 (B6)", () => {
    // 무한 재시도를 막는 경계 — 이 줄이 깨지면 실패 건이 큐를 영원히 돈다
    assert.equal(nextStatus("error", MAX_ATTEMPTS), "failed");
});

test("attempts가 상한을 넘어도 failed다", () => {
    assert.equal(nextStatus("error", MAX_ATTEMPTS + 5), "failed");
});

// ── nextStatus("defer") — W13 ──

test("한도에 막혀 미룬 행은 pending으로 돌아간다 (W13)", () => {
    assert.equal(nextStatus("defer", 1), "pending");
});

test("미룸은 시도 횟수를 다 써도 failed가 아니다 (W13)", () => {
    // 한도는 실패가 아니다 — 며칠 밀려도 메일이 사라지면 안 된다
    assert.equal(nextStatus("defer", MAX_ATTEMPTS), "pending");
    assert.equal(nextStatus("defer", MAX_ATTEMPTS + 5), "pending");
});

// ── planQueueRow — 처리 결과로 줄을 어떻게 남기나 (W13·W14, 실패 + 미룸) ──

const RETRY = new Date("2026-10-03T00:00:00Z");
const result = (over: Partial<QueueRowResult> = {}): QueueRowResult => ({
    outcome: "ok",
    attempts: 1,
    deferral: null,
    failedLinkIds: [],
    exhaustedLinkIds: [],
    ...over,
});

test("발송·건너뜀·실패는 예전 nextStatus와 같다 (B6)", () => {
    assert.equal(planQueueRow(result({ outcome: "ok" })).status, "sent");
    assert.equal(planQueueRow(result({ outcome: "skip", attempts: MAX_ATTEMPTS })).status, "skipped");
    const retry = planQueueRow(result({ outcome: "error", attempts: 1, failedLinkIds: [7] }));
    assert.deepEqual(retry, { status: "pending", attempts: 1, scheduledAt: null, exhaustedLinkIds: [], stat: "requeued" });
    const failed = planQueueRow(result({ outcome: "error", attempts: MAX_ATTEMPTS, failedLinkIds: [7] }));
    assert.deepEqual(failed, {
        status: "failed",
        attempts: MAX_ATTEMPTS,
        scheduledAt: null,
        exhaustedLinkIds: [],
        stat: "failed",
    });
});

test("미룬 줄은 꺼낼 때 올린 시도 1을 되돌리고 retryAt에 다시 꺼낸다 (W14)", () => {
    const p = planQueueRow(result({ outcome: "defer", attempts: 1, deferral: { retryAt: RETRY } }));
    assert.deepEqual(p, { status: "pending", attempts: 0, scheduledAt: RETRY, exhaustedLinkIds: [], stat: "deferred" });
    // 넘겨준 Date를 그대로 쓰지 않는다
    assert.notEqual(p.scheduledAt, RETRY);
});

test("며칠을 미뤄도 시도 횟수가 쌓이지 않는다 — 나중에 일시 오류 한 번에 failed가 되지 않게 (W14)", () => {
    // 꺼낼 때마다 +1, 미룰 때마다 -1 → 몇 번을 미뤄도 처음 값으로 돌아온다
    let stored = 0;
    for (let day = 0; day < 10; day++) {
        const picked = stored + 1;
        stored = planQueueRow(result({ outcome: "defer", attempts: picked, deferral: { retryAt: RETRY } })).attempts;
    }
    assert.equal(stored, 0);
    // 그 뒤 일시 오류가 나도 남은 시도로 다시 한다
    assert.equal(planQueueRow(result({ outcome: "error", attempts: stored + 1, failedLinkIds: [1] })).status, "pending");
});

test("미룸 되돌리기는 0 아래로 내려가지 않는다 (W14)", () => {
    assert.equal(planQueueRow(result({ outcome: "defer", attempts: 0, deferral: { retryAt: RETRY } })).attempts, 0);
});

test("시도를 다 쓴 줄을 미뤄도 failed가 되지 않고 시도가 하나 남는다 (W14)", () => {
    const p = planQueueRow(result({ outcome: "defer", attempts: MAX_ATTEMPTS, deferral: { retryAt: RETRY } }));
    assert.equal(p.status, "pending");
    assert.equal(p.attempts, MAX_ATTEMPTS - 1);
});

test("미룸인데 시각이 없으면 실패로 보고 시도 횟수를 쓴다 — 같은 회차에 끝없이 다시 꺼내지 않게", () => {
    assert.equal(planQueueRow(result({ outcome: "defer", attempts: 1, deferral: null })).stat, "requeued");
    assert.equal(planQueueRow(result({ outcome: "defer", attempts: MAX_ATTEMPTS, deferral: null })).status, "failed");
});

test("실패 + 미룸, 시도가 남았으면 보통 실패처럼 바로 다시 한다 — 앞 규칙 재시도는 뒤 규칙 한도와 상관없다", () => {
    const p = planQueueRow(
        result({ outcome: "error", attempts: 1, deferral: { retryAt: RETRY }, failedLinkIds: [1] }),
    );
    assert.deepEqual(p, { status: "pending", attempts: 1, scheduledAt: null, exhaustedLinkIds: [], stat: "requeued" });
});

test("실패 + 미룸, 시도를 다 쓰면 failed로 닫지 않고 실패한 규칙만 빼서 retryAt에 미룬 규칙을 다시 한다", () => {
    const p = planQueueRow(
        result({ outcome: "error", attempts: MAX_ATTEMPTS, deferral: { retryAt: RETRY }, failedLinkIds: [1] }),
    );
    assert.deepEqual(p, { status: "pending", attempts: 0, scheduledAt: RETRY, exhaustedLinkIds: [1], stat: "deferred" });
});

test("실패 + 미룸 줄의 흐름: 앞 규칙 3번 실패 → 빼고 미룸 → 뒤 규칙 발송 → sent (메일을 잃지 않는다)", () => {
    // 규칙 1(앞)은 계속 실패, 규칙 2(뒤)는 묶음 한도로 미뤄진다
    let stored = { attempts: 0, exhausted: [] as number[] };
    const tries: string[] = [];
    const step = (r: Omit<QueueRowResult, "attempts" | "exhaustedLinkIds">) => {
        const p = planQueueRow({ ...r, attempts: stored.attempts + 1, exhaustedLinkIds: stored.exhausted });
        stored = { attempts: p.attempts, exhausted: p.exhaustedLinkIds };
        tries.push(`${p.status}${p.scheduledAt ? "@retry" : ""}`);
        return p;
    };
    const failAndDefer = { outcome: "error" as const, deferral: { retryAt: RETRY }, failedLinkIds: [1] };
    step(failAndDefer);
    step(failAndDefer);
    step(failAndDefer);
    // 다음에 꺼낼 때 규칙 1은 돌리지 않는다(retry_exhausted로 건너뜀) — 규칙 2가 열려 나갔다
    const last = step({ outcome: "ok", deferral: null, failedLinkIds: [] });
    assert.deepEqual(tries, ["pending", "pending", "pending@retry", "sent"]);
    assert.deepEqual(last.exhaustedLinkIds, [1]);
});

test("빼 둔 규칙만 남고 나머지가 보낼 것 없음이면 failed로 닫는다 — 그 규칙은 끝내 실패했다", () => {
    const p = planQueueRow(result({ outcome: "skip", attempts: 1, exhaustedLinkIds: [1] }));
    assert.equal(p.status, "failed");
    assert.equal(p.stat, "failed");
});

test("빼 둔 뒤에도 미룸만 나오면 보통 미룸이다 (시도 횟수를 쓰지 않는다)", () => {
    const p = planQueueRow(result({ outcome: "defer", attempts: 1, deferral: { retryAt: RETRY }, exhaustedLinkIds: [1] }));
    assert.deepEqual(p, { status: "pending", attempts: 0, scheduledAt: RETRY, exhaustedLinkIds: [1], stat: "deferred" });
});

test("새로 뺄 규칙이 없으면 failed로 닫는다 — 규칙 수만큼만 되풀이되고 끝난다", () => {
    const p = planQueueRow(
        result({
            outcome: "error",
            attempts: MAX_ATTEMPTS,
            deferral: { retryAt: RETRY },
            failedLinkIds: [1],
            exhaustedLinkIds: [1],
        }),
    );
    assert.equal(p.status, "failed");
    // 던져서 실패 규칙을 모르는 경우도 같다
    const thrown = planQueueRow(result({ outcome: "error", attempts: MAX_ATTEMPTS, deferral: { retryAt: RETRY } }));
    assert.equal(thrown.status, "failed");
});

test("뒤 규칙도 계속 실패하면 그 규칙도 시도 3번 뒤 빠지고, 미룬 규칙이 더 없으면 failed로 끝난다", () => {
    const p = planQueueRow(
        result({
            outcome: "error",
            attempts: MAX_ATTEMPTS,
            deferral: { retryAt: RETRY },
            failedLinkIds: [2, 2],
            exhaustedLinkIds: [1],
        }),
    );
    assert.deepEqual(p.exhaustedLinkIds, [1, 2]);
    const end = planQueueRow(result({ outcome: "error", attempts: MAX_ATTEMPTS, failedLinkIds: [3], exhaustedLinkIds: [1, 2] }));
    assert.equal(end.status, "failed");
    assert.deepEqual(end.exhaustedLinkIds, [1, 2]);
});

// ── revivesOnRequeue — 처리 중에 바로 보내는 경로가 미룬 요청 ──

test("처리 중 다시 처리 요청이 있으면 보낼 것 없음·실패로 끝내지 않는다 — 고친 레코드의 미룬 메일을 잃지 않게", () => {
    assert.equal(revivesOnRequeue("skipped"), true);
    assert.equal(revivesOnRequeue("failed"), true);
});

test("처리 중 다시 처리 요청이 있어도 보낸 줄은 다시 꺼내지 않는다 — 쿨다운이 막았을 두 번째 메일", () => {
    assert.equal(revivesOnRequeue("sent"), false);
    // pending은 어차피 다시 꺼낸다 (이른 시각을 고르는 것은 SQL이 한다)
    assert.equal(revivesOnRequeue("pending"), false);
});

// ── parseLinkIdList ──

test("parseLinkIdList는 jsonb 배열(또는 JSON 문자열)에서 양의 정수만 중복 없이 읽는다", () => {
    assert.deepEqual(parseLinkIdList([3, 1, 3]), [3, 1]);
    assert.deepEqual(parseLinkIdList("[5, 0, -1, 2.5, \"7\", 6]"), [5, 6]);
    assert.deepEqual(parseLinkIdList(null), []);
    assert.deepEqual(parseLinkIdList(undefined), []);
    assert.deepEqual(parseLinkIdList("not json"), []);
    assert.deepEqual(parseLinkIdList({ 0: 1 }), []);
});

// ── isStuck — B7 ──

const T0 = new Date("2026-09-01T10:00:00Z");
const THRESHOLD = 15 * 60 * 1000;

test("임계 시간을 넘긴 processing 행은 stuck이다 (B7)", () => {
    const lockedAt = new Date(T0.getTime() - 16 * 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), true);
});

test("아직 처리 중일 수 있는 행은 stuck이 아니다 (B7)", () => {
    // 워커 상한이 8분이므로 15분 미만은 정상 처리 중일 수 있다
    const lockedAt = new Date(T0.getTime() - 8 * 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

test("정확히 임계값이면 아직 stuck이 아니다", () => {
    const lockedAt = new Date(T0.getTime() - THRESHOLD);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

test("lockedAt이 없으면 stuck이 아니다", () => {
    // processing이 아닌 행이 섞여 들어와도 오판하지 않는다
    assert.equal(isStuck(null, T0, THRESHOLD), false);
});

test("lockedAt이 미래여도 stuck이 아니다", () => {
    // 서버 시계가 어긋나도 멀쩡한 행을 회수하지 않는다
    const lockedAt = new Date(T0.getTime() + 60 * 1000);
    assert.equal(isStuck(lockedAt, T0, THRESHOLD), false);
});

// ── isDeadlineExceeded — B3 ──

test("예산 안이면 계속 처리한다 (B3)", () => {
    assert.equal(isDeadlineExceeded(1000, 1000 + 60_000, 480_000), false);
});

test("예산을 넘기면 다음 회차로 넘긴다 (B3)", () => {
    assert.equal(isDeadlineExceeded(1000, 1000 + 481_000, 480_000), true);
});

test("정확히 예산이면 넘긴 것으로 본다", () => {
    // 경계에서 한 배치 더 도는 것보다 일찍 끊는 쪽이 안전하다 (HTTP 타임아웃 회피)
    assert.equal(isDeadlineExceeded(1000, 1000 + 480_000, 480_000), true);
});

// ── 줄 하나의 처리 결과 → 줄에 쓸 값 (줄마다 처리·묶어 미루기가 같이 쓴다) ──

const RETRY_AT = new Date("2026-10-05T00:00:00.000Z"); // 10/5 09:00 KST

test("toProcessedRow: 미룸만 있으면 defer와 그 시각·이유", () => {
    const p = toProcessedRow({
        noMatchingRules: false,
        outcomes: [{ kind: "deferred", linkId: 7, retryAt: RETRY_AT, reason: "daily_limit" }],
    });
    assert.equal(p.outcome, "defer");
    assert.deepEqual(p.deferral, { retryAt: RETRY_AT, reason: "daily_limit" });
    assert.deepEqual(p.failedLinkIds, []);
    assert.match(p.detail, /link 7: deferred \(daily_limit\)/);
});

test("toProcessedRow: 규칙이 없으면 skip (no matching rules)", () => {
    const p = toProcessedRow({ noMatchingRules: true, outcomes: [] });
    assert.equal(p.outcome, "skip");
    assert.equal(p.detail, "no matching rules");
    assert.equal(p.deferral, null);
});

test("toProcessedRow: 실패와 미룸이 섞이면 error지만 미룬 시각을 남긴다", () => {
    const p = toProcessedRow({
        noMatchingRules: false,
        outcomes: [
            { kind: "failed", linkId: 1, error: "boom" },
            { kind: "deferred", linkId: 2, retryAt: RETRY_AT, reason: "spacing" },
        ],
    });
    assert.equal(p.outcome, "error");
    assert.deepEqual(p.failedLinkIds, [1]);
    assert.equal(p.deferral?.retryAt.getTime(), RETRY_AT.getTime());
});

test("recordDeletedRow: 지워진 레코드는 재시도 없는 skip", () => {
    assert.deepEqual(recordDeletedRow(), { outcome: "skip", detail: "record deleted", deferral: null, failedLinkIds: [] });
});

test("describePlan: 순수 미룸은 짧은 미룸 문구", () => {
    const processed = toProcessedRow({
        noMatchingRules: false,
        outcomes: [{ kind: "deferred", linkId: 7, retryAt: RETRY_AT, reason: "daily_limit" }],
    });
    const plan = planQueueRow({ outcome: "defer", attempts: 1, deferral: processed.deferral, failedLinkIds: [], exhaustedLinkIds: [] });
    assert.equal(describePlan(plan, processed, []), "deferred(daily_limit) until 10/5 09:00");
});

test("describePlan: 시도를 다 써 뺀 규칙이 생기면 그 규칙과 다시 시도할 시각을 앞에 적는다", () => {
    const processed = toProcessedRow({
        noMatchingRules: false,
        outcomes: [
            { kind: "failed", linkId: 1, error: "boom" },
            { kind: "deferred", linkId: 2, retryAt: RETRY_AT, reason: "daily_limit" },
        ],
    });
    const plan = planQueueRow({
        outcome: processed.outcome,
        attempts: MAX_ATTEMPTS,
        deferral: processed.deferral,
        failedLinkIds: processed.failedLinkIds,
        exhaustedLinkIds: [],
    });
    assert.match(describePlan(plan, processed, []), /^retry exhausted: link 1 \(not run again\), rest at 10\/5 09:00 KST; link 1: failed/);
});

test("toQueueRowWrite: 미룸은 pending·시도 되돌림·시각·되살리지 않음", () => {
    const plan = planQueueRow({ outcome: "defer", attempts: 3, deferral: { retryAt: RETRY_AT }, failedLinkIds: [], exhaustedLinkIds: [] });
    const w = toQueueRowWrite(11, plan, "deferred(daily_limit) until 10/5 09:00", { stampLock: true });
    assert.deepEqual(w, {
        id: 11,
        status: "pending",
        attempts: 2,
        scheduled_at: RETRY_AT.toISOString(),
        exhausted: null,
        revivable: false,
        pending: true,
        last_error: "deferred(daily_limit) until 10/5 09:00",
        stamp_lock: true,
    });
});

test("toQueueRowWrite: 보낸 줄은 last_error를 비우고, 건너뛴 줄은 되살릴 수 있다", () => {
    const sent = planQueueRow({ outcome: "ok", attempts: 1, deferral: null, failedLinkIds: [], exhaustedLinkIds: [] });
    assert.equal(toQueueRowWrite(1, sent, "link 1: sent").last_error, null);
    const skipped = planQueueRow({ outcome: "skip", attempts: 1, deferral: null, failedLinkIds: [], exhaustedLinkIds: [] });
    const w = toQueueRowWrite(2, skipped, "link 1: skipped (cooldown)");
    assert.equal(w.status, "skipped");
    assert.equal(w.revivable, true);
    assert.equal(w.pending, false);
    assert.equal(w.scheduled_at, null);
    assert.equal(w.stamp_lock, false);
});

test("toQueueRowWrite: 문구는 2000자로 자르고 뺀 규칙은 배열로 남긴다", () => {
    const plan = planQueueRow({ outcome: "skip", attempts: 3, deferral: null, failedLinkIds: [], exhaustedLinkIds: [4, 5] });
    const w = toQueueRowWrite(3, plan, "x".repeat(2500));
    assert.equal(w.last_error?.length, 2000);
    assert.deepEqual(w.exhausted, [4, 5]);
    assert.equal(w.status, "failed");
});

test("toWellFormed: 잘린 이모지(짝 없는 서로게이트)는 U+FFFD로, 온전한 글자는 그대로", () => {
    const emoji = "😀"; // 😀
    assert.equal(toWellFormed("가" + emoji), "가" + emoji);
    assert.equal(toWellFormed(("a" + emoji).slice(0, 2)), "a�");
    assert.equal(toWellFormed("\uDE00b"), "�b");
    // 2000자 경계에서 잘린 이모지도 JSON으로 안전하게 넘어간다
    const cut = toQueueRowWrite(
        1,
        planQueueRow({ outcome: "skip", attempts: 1, deferral: null, failedLinkIds: [], exhaustedLinkIds: [] }),
        "a".repeat(1999) + emoji
    ).last_error!;
    assert.equal(cut.length, 2000);
    assert.ok(cut.endsWith("�"));
});

test("drainGroupKey: 조직·파티션·트리거가 같으면 같은 묶음", () => {
    const a = drainGroupKey({ org_id: "o1", partition_id: 3, trigger_type: "on_create" });
    assert.equal(a, drainGroupKey({ org_id: "o1", partition_id: 3, trigger_type: "on_create" }));
    assert.notEqual(a, drainGroupKey({ org_id: "o1", partition_id: 3, trigger_type: "on_update" }));
    assert.notEqual(a, drainGroupKey({ org_id: "o1", partition_id: 4, trigger_type: "on_create" }));
});

// ── walkQueueRow — processAutoPersonalizedEmail과 같은 순서·같은 규칙별 결과 ──

const LINK: QueueWalkLink = { id: 10, recipientField: "email", preventDuplicate: 0, model: null };
const DATA = { email: "kim@example.test", companyName: "가나다" };

/** 모든 검사를 통과하고 발신 주소가 막힌 상태 (항목만 바꿔 쓴다) */
function lookups(over: Partial<QueueWalkLookups> = {}): QueueWalkLookups {
    return {
        conditionMet: () => true,
        cooldownActive: false,
        isDuplicate: () => false,
        workspaceId: 1,
        isUnsubscribed: () => false,
        aiClientReady: () => true,
        quotaAllowed: true,
        emailClientReady: true,
        poolBlock: () => ({ blocked: true, reason: "daily_limit" }),
        ...over,
    };
}

function walk(over: Partial<QueueWalkLookups> = {}, input: Partial<Parameters<typeof walkQueueRow>[0]> = {}) {
    return walkQueueRow({ data: DATA, links: [LINK], skipLinkIds: [], ...input }, lookups(over));
}

function skippedReasons(w: ReturnType<typeof walkQueueRow>): string[] {
    assert.equal(w.kind, "skip");
    if (w.kind !== "skip") return [];
    return w.result.outcomes.map((o) => (o.kind === "skipped" ? o.reason : o.kind));
}

test("walkQueueRow: 규칙이 없으면 noMatchingRules (줄마다 처리와 같은 skip)", () => {
    const w = walkQueueRow({ data: DATA, links: [], skipLinkIds: [] }, lookups());
    assert.deepEqual(w, { kind: "skip", result: { noMatchingRules: true, outcomes: [] } });
});

test("walkQueueRow: 모든 검사를 지나 막힌 묶음에 닿으면 defer (뒤 규칙은 보지 않는다)", () => {
    const second: QueueWalkLink = { ...LINK, id: 11 };
    let secondSeen = false;
    const w = walkQueueRow(
        { data: DATA, links: [LINK, second], skipLinkIds: [] },
        lookups({
            conditionMet: (l) => {
                if (l.id === 11) secondSeen = true;
                return true;
            },
        })
    );
    assert.deepEqual(w, { kind: "defer", skipped: [], linkId: 10, reason: "daily_limit" });
    assert.equal(secondSeen, false);
});

test("walkQueueRow: 검사 순서가 processAutoPersonalizedEmail과 같다 (앞 검사에 걸리면 뒤 이유가 나오지 않는다)", () => {
    // 모두 걸리게 해 두고 앞에서부터 하나씩 풀어 가며 나오는 이유를 본다
    const order: Array<[string, Partial<QueueWalkLookups>]> = [
        ["condition_not_met", { conditionMet: () => false }],
        ["cooldown", { cooldownActive: true }],
        ["invalid_email", {}], // 아래에서 data로 건다
        ["workspace_not_found", { workspaceId: null }],
        ["unsubscribed", { isUnsubscribed: () => true }],
        ["no_ai_client", { aiClientReady: () => false }],
        ["quota_exceeded", { quotaAllowed: false }],
        ["no_email_client", { emailClientReady: false }],
    ];
    for (let i = 0; i < order.length; i++) {
        // i번째 검사 하나만 걸고 나머지는 통과 → 그 이유가 나와야 한다
        const [reason, over] = order[i];
        const data = reason === "invalid_email" ? { email: "not-an-email" } : DATA;
        assert.deepEqual(skippedReasons(walk(over, { data })), [reason], reason);
        // 앞 검사와 함께 걸면 앞 이유가 이긴다
        if (i > 0) {
            const [prevReason, prevOver] = order[i - 1];
            const prevData = prevReason === "invalid_email" || reason === "invalid_email" ? { email: "x" } : DATA;
            const both = skippedReasons(walk({ ...over, ...prevOver }, { data: prevData }));
            assert.deepEqual(both, [prevReason], `${prevReason} before ${reason}`);
        }
    }
});

test("walkQueueRow: 중복 수신자는 쿨다운 뒤·메일 모양 검사 앞에서 본다 (preventDuplicate 규칙만)", () => {
    const dupLink: QueueWalkLink = { ...LINK, preventDuplicate: 1 };
    const w = walkQueueRow({ data: DATA, links: [dupLink], skipLinkIds: [] }, lookups({ isDuplicate: () => true }));
    assert.deepEqual(skippedReasons(w), ["duplicate_recipient"]);
    // 쿨다운이 먼저다
    const w2 = walkQueueRow(
        { data: DATA, links: [dupLink], skipLinkIds: [] },
        lookups({ isDuplicate: () => true, cooldownActive: true })
    );
    assert.deepEqual(skippedReasons(w2), ["cooldown"]);
    // preventDuplicate가 없으면 중복 이력이 있어도 보지 않는다
    assert.equal(walk({ isDuplicate: () => true }).kind, "defer");
    // 받는 칸이 비었으면 중복 확인 없이 invalid_email
    const w3 = walkQueueRow({ data: { email: "" }, links: [dupLink], skipLinkIds: [] }, lookups({ isDuplicate: () => undefined }));
    assert.deepEqual(skippedReasons(w3), ["invalid_email"]);
});

test("walkQueueRow: 시도를 다 써 뺀 규칙은 retry_exhausted로 넘기고 다음 규칙을 본다", () => {
    const second: QueueWalkLink = { ...LINK, id: 11 };
    const w = walkQueueRow({ data: DATA, links: [LINK, second], skipLinkIds: [10] }, lookups());
    assert.deepEqual(w, {
        kind: "defer",
        skipped: [{ kind: "skipped", linkId: 10, reason: "retry_exhausted" }],
        linkId: 11,
        reason: "daily_limit",
    });
});

test("walkQueueRow: 앞 규칙을 건너뛰고 뒤 규칙이 미뤄지면 건너뛴 결과를 앞에 둔다", () => {
    const second: QueueWalkLink = { ...LINK, id: 11 };
    const w = walkQueueRow(
        { data: DATA, links: [LINK, second], skipLinkIds: [] },
        lookups({ conditionMet: (l) => l.id !== 10 })
    );
    assert.equal(w.kind, "defer");
    if (w.kind !== "defer") return;
    const outcome = deferredRecordOutcome(w, RETRY_AT);
    assert.deepEqual(outcome, {
        noMatchingRules: false,
        outcomes: [
            { kind: "skipped", linkId: 10, reason: "condition_not_met" },
            { kind: "deferred", linkId: 11, retryAt: RETRY_AT, reason: "daily_limit" },
        ],
    });
    assert.equal(toProcessedRow(outcome).outcome, "defer");
});

test("walkQueueRow: 발신 주소가 열려 있으면(보낼 수 있다) 줄마다 처리로 돌린다", () => {
    assert.deepEqual(walk({ poolBlock: () => ({ blocked: false }) }), { kind: "process", why: "sender_open" });
});

test("walkQueueRow: 쿼터 → 메일 설정 → 발신 주소 순으로, 그 자리에 닿았을 때만 읽기를 청한다", () => {
    assert.deepEqual(walk({ quotaAllowed: undefined, emailClientReady: undefined, poolBlock: () => undefined }), {
        kind: "need",
        need: "quota",
    });
    assert.deepEqual(walk({ emailClientReady: undefined, poolBlock: () => undefined }), { kind: "need", need: "emailClient" });
    assert.deepEqual(walk({ poolBlock: () => undefined }), { kind: "need", need: "pool" });
    // 앞에서 건너뛰는 줄은 쿼터를 읽지 않는다 (쿼터 확인은 그달 줄을 만들 수 있다)
    assert.deepEqual(skippedReasons(walk({ cooldownActive: true, quotaAllowed: undefined })), ["cooldown"]);
    // 쿼터가 막히면 메일 설정은 읽지 않는다
    assert.deepEqual(skippedReasons(walk({ quotaAllowed: false, emailClientReady: undefined })), ["quota_exceeded"]);
});

test("walkQueueRow: 원래 함수에서 던질 값(문자열 아닌 받는 값·던지는 조건·객체 아닌 data)은 줄마다 처리", () => {
    const dupLink: QueueWalkLink = { ...LINK, preventDuplicate: 1 };
    assert.equal(
        walkQueueRow({ data: { email: 12345 }, links: [dupLink], skipLinkIds: [] }, lookups()).kind,
        "process"
    );
    assert.equal(
        walk({
            conditionMet: () => {
                throw new TypeError("value.includes is not a function");
            },
        }).kind,
        "process"
    );
    assert.equal(walkQueueRow({ data: null, links: [LINK], skipLinkIds: [] }, lookups()).kind, "process");
    assert.equal(walkQueueRow({ data: [1], links: [LINK], skipLinkIds: [] }, lookups()).kind, "process");
    // 읽어 두지 않은 주소면(undefined) 짐작하지 않는다
    assert.equal(walk({ isUnsubscribed: () => undefined }).kind, "process");
});

test("walkQueueRow: 받는 칸이 숫자면(중복 확인 없음) invalid_email로 건너뛴다 — 원래 함수와 같다", () => {
    assert.deepEqual(skippedReasons(walk({}, { data: { email: 12345 } })), ["invalid_email"]);
});

test("walkQueueRow: 모델이 없으면 기본 모델(undefined)로 AI 클라이언트를 본다", () => {
    const seen: Array<string | undefined> = [];
    walkQueueRow(
        { data: DATA, links: [{ ...LINK, model: "" }, { ...LINK, id: 11, model: "claude-haiku-4-5" }], skipLinkIds: [] },
        lookups({
            aiClientReady: (m) => {
                seen.push(m);
                return false;
            },
        })
    );
    assert.deepEqual(seen, [undefined, "claude-haiku-4-5"]);
});

// ── DESIGN-2: 줄 우선순위 (문의 1 / 대량 0) ──

test("purposeOfQueuePriority: 1이면 문의, 0·이상한 값은 대량", () => {
    assert.equal(purposeOfQueuePriority(QUEUE_PRIORITY_INBOUND), "inbound");
    assert.equal(purposeOfQueuePriority(QUEUE_PRIORITY_BULK), "bulk");
    assert.equal(purposeOfQueuePriority(2), "inbound");
    // 드라이버가 문자열로 줄 때
    assert.equal(purposeOfQueuePriority("1"), "inbound");
    assert.equal(purposeOfQueuePriority("0"), "bulk");
    // 칸 기본값이 0이다
    assert.equal(purposeOfQueuePriority(null), "bulk");
    assert.equal(purposeOfQueuePriority(undefined), "bulk");
    assert.equal(purposeOfQueuePriority("x"), "bulk");
    assert.equal(purposeOfQueuePriority(-1), "bulk");
});

// ── bulkFifoScheduledAt — 새 대량 줄은 미뤄 둔 대량 줄을 앞지르지 않는다 (DESIGN-2 Q4) ──

test("Q4: 어제 밀린 대량 줄이 09:00에 열리는데 08:00에 새 명단이 오면 새 줄도 09:00부터", () => {
    // 시간대 없는 주소: 한도를 다 쓴 날의 남은 줄은 다음 날 09:00(DEFAULT_RESUME_HOUR)으로 미뤄진다.
    // 08:00에는 그날 한도가 새로 열려 있어 새 줄을 바로 꺼내면 어제 밀린 줄보다 먼저 나간다
    const now = new Date("2026-10-06T08:00:00+09:00");
    const resume = new Date("2026-10-06T09:00:00+09:00");
    assert.deepEqual(bulkFifoScheduledAt(null, now, resume), resume);
    // 같은 시각이 되면 id 순(먼저 들어온 순)으로 꺼낸다 — 밀린 줄이 먼저다
});

test("bulkFifoScheduledAt: 미룬 줄이 없거나 이미 열렸으면 지금(칸 기본값) 그대로", () => {
    const now = new Date("2026-10-06T10:00:00+09:00");
    assert.equal(bulkFifoScheduledAt(null, now, null), null);
    assert.equal(bulkFifoScheduledAt(null, now, new Date("2026-10-06T09:00:00+09:00")), null);
    assert.equal(bulkFifoScheduledAt(null, now, now), null);
});

test("bulkFifoScheduledAt: 호출한 쪽이 정한 시각은 당기지 않고, 미룬 줄보다 이르면 미룬 줄 시각으로", () => {
    const now = new Date("2026-10-06T08:00:00+09:00");
    const requestedLate = new Date("2026-10-07T12:00:00+09:00");
    const requestedEarly = new Date("2026-10-06T08:30:00+09:00");
    const deferred = new Date("2026-10-06T15:00:00+09:00");
    assert.deepEqual(bulkFifoScheduledAt(requestedLate, now, deferred), requestedLate);
    assert.deepEqual(bulkFifoScheduledAt(requestedEarly, now, deferred), deferred);
    assert.deepEqual(bulkFifoScheduledAt(requestedEarly, now, null), requestedEarly);
    // 늘 새 Date — 호출한 쪽 값을 고쳐도 서로 영향이 없다
    const out = bulkFifoScheduledAt(null, now, deferred);
    assert.notEqual(out, deferred);
});

test("drainGroupKey: priority가 다르면 다른 묶음 — 문의 줄과 대량 줄은 따로 미룬다", () => {
    const base = { org_id: "o1", partition_id: 3, trigger_type: "on_create" };
    const bulk = drainGroupKey({ ...base, priority: QUEUE_PRIORITY_BULK });
    const inbound = drainGroupKey({ ...base, priority: QUEUE_PRIORITY_INBOUND });
    assert.notEqual(bulk, inbound);
    assert.equal(bulk, drainGroupKey({ ...base, priority: 0 }));
    // priority를 모르면 대량(0)으로 본다 — 예전 호출과 같은 키
    assert.equal(drainGroupKey(base), bulk);
    assert.equal(drainGroupKey({ ...base, priority: null }), bulk);
});

// ── REVIEW-2 안전 F1: 선입선출 하한은 오늘 아침 다시 열리기를 기다리는 줄에만, 묶음이 하나인 파티션에만 ──

test("bulkFifoScheduledAt: 미룬 줄이 내일 이후에 열리면 하한을 걸지 않는다 (새 줄은 지금 넣는다)", () => {
    // 13:00에 다른 규칙·옛 설정 때문에 내일 09:00으로 미뤄 둔 줄이 있어도 새 가져오기를 하루 가까이 묶지 않는다.
    // 새 줄도 같은 이유로 막히면 꺼내자마자 같은 시각(내일 09:00)으로 미뤄져 id 순(먼저 들어온 순) 그대로다
    const now = new Date("2026-10-06T13:00:00+09:00");
    const tomorrow9 = new Date("2026-10-07T09:00:00+09:00");
    assert.equal(bulkFifoScheduledAt(null, now, tomorrow9), null);
    // 자정이 지나 그 줄이 오늘 09:00을 기다리게 되면 그때는 하한을 건다 (00:00~09:00에 새 명단이 앞지르지 않게)
    const after = new Date("2026-10-07T02:00:00+09:00");
    assert.deepEqual(bulkFifoScheduledAt(null, after, tomorrow9), tomorrow9);
    // 한국 날짜로 본다 — UTC로는 같은 날이어도 KST로 다음 날이면 걸지 않는다 (10/6 23:30 KST = 10/6 14:30 UTC, 10/7 08:00 KST = 10/6 23:00 UTC)
    assert.equal(
        bulkFifoScheduledAt(null, new Date("2026-10-06T23:30:00+09:00"), new Date("2026-10-07T08:00:00+09:00")),
        null
    );
});

test("FIFO_FLOOR_DEFER_REASONS: 한도·시간대·정지만 센다 — 간격 미룸은 그날 안에 펼쳐져 있어 세지 않는다", () => {
    assert.deepEqual([...FIFO_FLOOR_DEFER_REASONS].sort(), ["daily_limit", "outside_window", "paused"]);
    assert.ok(!FIFO_FLOOR_DEFER_REASONS.includes("spacing"));
});

test("sharesOneSenderPool: 켜진 규칙이 모두 같은 주소 묶음이면 true, 하나라도 다르면 false", () => {
    assert.equal(sharesOneSenderPool([]), true);
    assert.equal(sharesOneSenderPool([{ senderProfileId: 1, senderProfileIds: [1, 2] }]), true);
    // 순서·중복이 달라도 같은 주소 집합이면 같은 묶음
    assert.equal(
        sharesOneSenderPool([
            { senderProfileId: 1, senderProfileIds: [1, 2] },
            { senderProfileId: 2, senderProfileIds: [2, 1, 2] },
        ]),
        true
    );
    // 옛 칸 하나만 있는 규칙은 그 주소 하나
    assert.equal(
        sharesOneSenderPool([
            { senderProfileId: 3, senderProfileIds: null },
            { senderProfileId: null, senderProfileIds: [3] },
        ]),
        true
    );
    // 묶음이 다른 규칙 (조건이 다른 규칙 A·B — 리뷰 시나리오 1)
    assert.equal(
        sharesOneSenderPool([
            { senderProfileId: 1, senderProfileIds: [1] },
            { senderProfileId: 2, senderProfileIds: [2, 3, 4] },
        ]),
        false
    );
    // 기본 주소로 보내는 규칙(빈 묶음)끼리는 같다, 빈 묶음과 지정 묶음은 다르다
    assert.equal(
        sharesOneSenderPool([
            { senderProfileId: null, senderProfileIds: null },
            { senderProfileId: null, senderProfileIds: [] },
        ]),
        true
    );
    assert.equal(
        sharesOneSenderPool([
            { senderProfileId: null, senderProfileIds: null },
            { senderProfileId: 1, senderProfileIds: [1] },
        ]),
        false
    );
});

// ── REVIEW-2 정책 F1 / 검증 S1: 배치 안 자리 잡기는 꺼낸 순서대로 하나씩 ──

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

test("createClaimTurns: 늦게 닿은 앞 줄을 기다려 꺼낸 순서대로, 한 번에 하나씩 잡는다", async () => {
    const turns = createClaimTurns(3);
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const claim = (name: string) => async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        log.push(`start ${name}`);
        await tick(5);
        log.push(`end ${name}`);
        running--;
        return name;
    };
    // 줄 2가 가장 먼저, 줄 0이 가장 늦게 자리 잡기 지점에 닿는다 (앞 단계 조회 시간이 줄마다 다르다)
    const rows = [
        (async () => { await tick(30); return turns[0].run(claim("0")); })(),
        (async () => { await tick(15); return turns[1].run(claim("1")); })(),
        (async () => turns[2].run(claim("2")))(),
    ];
    assert.deepEqual(await Promise.all(rows), ["0", "1", "2"]);
    assert.deepEqual(log, ["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
    assert.equal(maxRunning, 1);
});

test("createClaimTurns: 자리를 잡지 않고 끝난 줄(done)은 뒤 줄을 막지 않는다, 던진 자리 잡기도 차례를 넘긴다", async () => {
    const turns = createClaimTurns(3);
    const order: number[] = [];
    // 줄 0은 건너뜀(조건 불충족 등)으로 끝난다 — 자리 잡기 없이 done
    setTimeout(() => turns[0].done(), 10);
    // 줄 1의 자리 잡기는 던진다
    const r1 = turns[1].run(async () => {
        order.push(1);
        throw new Error("DB 오류");
    });
    const r2 = turns[2].run(async () => {
        order.push(2);
        return "ok";
    });
    await assert.rejects(r1, /DB 오류/);
    assert.equal(await r2, "ok");
    assert.deepEqual(order, [1, 2]);
    // done을 여러 번 불러도 된다
    turns[0].done();
    turns[1].done();
});

test("createClaimTurns: 한 줄의 두 번째 자리 잡기(규칙 여럿)는 차례를 다시 기다리지 않고 한 번에 하나만 지킨다", async () => {
    const turns = createClaimTurns(2);
    const log: string[] = [];
    await turns[0].run(async () => log.push("0a"));
    // 줄 1이 아직 자리 잡기 전이어도 줄 0의 두 번째 자리 잡기는 바로 돈다 (줄 1을 기다리면 서로 기다릴 수 있다)
    await turns[0].run(async () => log.push("0b"));
    await turns[1].run(async () => log.push("1a"));
    assert.deepEqual(log, ["0a", "0b", "1a"]);
    assert.deepEqual(createClaimTurns(0), []);
});

/**
 * 배치 모델: claimSender처럼 "사용량 읽기 → 가장 오래 쉰 주소 → 자리 잡기"를 비동기로 흉내 낸다.
 * 차례 없이 함께 돌리면 같은 사용량을 읽어 한 주소에 몰리고(검증 S6 u1u1u1u2u1), 차례대로면 돌아가며 고르게 간다.
 */
async function modelBatch(useTurns: boolean, size: number, addresses: number[]): Promise<number[]> {
    const lastSent = new Map<number, number>(addresses.map((a) => [a, 0]));
    let clock = 0;
    const claimOnce = async (): Promise<number> => {
        const snapshot = new Map(lastSent); // 사용량 읽기
        await tick(1); // 판정과 자리 잡기 사이
        const pick = [...snapshot.entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0])[0][0];
        lastSent.set(pick, ++clock); // 자리 잡기 (한도·간격 없음 — 조건부 upsert가 늘 성공)
        return pick;
    };
    const turns = createClaimTurns(size);
    return Promise.all(
        Array.from({ length: size }, (_, i) =>
            (useTurns ? turns[i].run(claimOnce) : claimOnce()).finally(() => turns[i].done())
        )
    );
}

test("배치 모델(Q1·Q9): 차례대로 잡으면 한도 없는 주소 둘에 5통이 돌아가며 3·2로 간다", async () => {
    const together = await modelBatch(false, 5, [1, 2]);
    // 예전 동작 재현: 다섯 줄이 같은 순간을 읽어 모두 1번 주소
    assert.deepEqual(together, [1, 1, 1, 1, 1]);
    const ordered = await modelBatch(true, 5, [1, 2]);
    assert.deepEqual(ordered, [1, 2, 1, 2, 1]);
});

test("sortPickedRows: RETURNING이 뒤섞어 돌려준 줄을 배치 안 차례(문의 먼저 → 먼저 들어온 순)로", () => {
    const rows = [
        { id: 7, priority: 0 },
        { id: 10, priority: 0 },
        { id: 6, priority: 0 },
        { id: 3, priority: 0 },
        // db.execute는 문자열로 줄 수 있다
        { id: 21, priority: "1" },
        { id: 8, priority: 0 },
    ];
    assert.deepEqual(
        sortPickedRows(rows).map((r) => r.id),
        [21, 3, 6, 7, 8, 10]
    );
    // 새 배열 — 넘긴 배열은 그대로
    assert.deepEqual(
        rows.map((r) => r.id),
        [7, 10, 6, 3, 21, 8]
    );
});

test("sortPickedRows: 배치 안에서는 예정 시각이 아니라 들어온 순 — 앞 칸을 문의에 내준 대량 줄이 계속 밀리지 않는다 (재검증 S7)", () => {
    // 고르게(54분 간격): 2번 줄은 09:54 칸을 문의에 내주고 10:49로 다시 미뤄졌고, 3번 줄은 미리 펼친 10:48 칸에 있다.
    // 10:50 워커가 둘을 함께 꺼내면 2번이 먼저 자리를 잡는다 (예정 시각 순이면 3번이 먼저고, 2번은 11:44로 또 밀려 4번(11:42) 뒤에 선다)
    const batch = [
        { id: 3, priority: 0, scheduledAt: "10:48" },
        { id: 2, priority: 0, scheduledAt: "10:49" },
    ];
    assert.deepEqual(
        sortPickedRows(batch).map((r) => r.id),
        [2, 3]
    );
});
