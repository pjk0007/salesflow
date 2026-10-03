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
