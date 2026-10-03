import { test } from "node:test";
import assert from "node:assert";
import {
    foldOutcome,
    describeOutcome,
    deferredUntil,
    failedLinkIds,
    type LinkOutcome,
    type RecordOutcome,
} from "./auto-personalized-email-outcome";
import type { SlotDeferReason } from "./email-sender-limit-rules";

const of = (outcomes: RecordOutcome["outcomes"], noMatchingRules = false): RecordOutcome => ({
    noMatchingRules,
    outcomes,
});

test("규칙이 없으면 skip이다", () => {
    assert.equal(foldOutcome(of([], true)), "skip");
});

test("발송했으면 ok다", () => {
    assert.equal(foldOutcome(of([{ kind: "sent", linkId: 1 }])), "ok");
});

test("전부 skip이면 skip이다", () => {
    const r = of([
        { kind: "skipped", linkId: 1, reason: "cooldown" },
        { kind: "skipped", linkId: 2, reason: "unsubscribed" },
    ]);
    assert.equal(foldOutcome(r), "skip");
});

test("실패가 있으면 error다", () => {
    assert.equal(foldOutcome(of([{ kind: "failed", linkId: 1, error: "NHN 500" }])), "error");
});

test("일부 발송 + 일부 실패면 error다 — 나머지를 재시도해야 한다", () => {
    // 이미 보낸 건은 checkCooldown이 중복 발송을 막으므로 재시도가 안전하다
    const r = of([
        { kind: "sent", linkId: 1 },
        { kind: "failed", linkId: 2, error: "timeout" },
    ]);
    assert.equal(foldOutcome(r), "error");
});

test("skip + 실패면 error다", () => {
    const r = of([
        { kind: "skipped", linkId: 1, reason: "cooldown" },
        { kind: "failed", linkId: 2, error: "timeout" },
    ]);
    assert.equal(foldOutcome(r), "error");
});

test("결과가 비어 있으면 skip이다", () => {
    // 규칙은 있었지만 전부 걸러진 경우 — 재시도 대상이 아니다
    assert.equal(foldOutcome(of([])), "skip");
});

// ── describeOutcome ──

test("규칙 없음을 사람이 읽게 적는다", () => {
    assert.equal(describeOutcome(of([], true)), "no matching rules");
});

test("실패 사유를 남긴다", () => {
    const r = of([{ kind: "failed", linkId: 7, error: "NHN 500" }]);
    assert.match(describeOutcome(r), /link 7: failed \(NHN 500\)/);
});

test("여러 결과를 모두 남긴다", () => {
    const r = of([
        { kind: "sent", linkId: 1 },
        { kind: "skipped", linkId: 2, reason: "cooldown" },
    ]);
    const s = describeOutcome(r);
    assert.match(s, /link 1: sent/);
    assert.match(s, /link 2: skipped \(cooldown\)/);
});

// ── 미룸 (deferred) — W12 ──

const deferred = (linkId: number, iso: string, reason: SlotDeferReason = "daily_limit"): LinkOutcome => ({
    kind: "deferred",
    linkId,
    retryAt: new Date(iso),
    reason,
});

test("미룸만 있으면 defer다 (W12)", () => {
    assert.equal(foldOutcome(of([deferred(1, "2026-10-03T00:00:00Z")])), "defer");
});

test("실패 + 미룸이면 error다 — 실패가 미룸보다 앞이다 (W12)", () => {
    const r = of([
        { kind: "failed", linkId: 1, error: "NHN 500" },
        deferred(2, "2026-10-03T00:00:00Z"),
    ]);
    assert.equal(foldOutcome(r), "error");
    // 대기열은 error여도 미룬 시각과 실패한 규칙을 함께 보고 미룬 메일을 잃지 않는다 (planQueueRow)
    assert.equal(deferredUntil(r)?.retryAt.toISOString(), "2026-10-03T00:00:00.000Z");
    assert.deepEqual(failedLinkIds(r), [1]);
});

test("시도 횟수를 다 써 뺀 규칙(retry_exhausted) + 미룸은 defer다 — 빼 둔 규칙은 실패로 세지 않는다", () => {
    const r = of([{ kind: "skipped", linkId: 1, reason: "retry_exhausted" }, deferred(2, "2026-10-03T00:00:00Z")]);
    assert.equal(foldOutcome(r), "defer");
    assert.deepEqual(failedLinkIds(r), []);
    assert.equal(describeOutcome(r), "link 1: skipped (retry_exhausted); link 2: deferred (daily_limit) until 2026-10-03T00:00:00.000Z");
});

test("failedLinkIds는 실패한 규칙만 결과 순서대로 중복 없이 준다", () => {
    const r = of([
        { kind: "failed", linkId: 4, error: "a" },
        { kind: "sent", linkId: 2 },
        { kind: "failed", linkId: 3, error: "b" },
        { kind: "failed", linkId: 4, error: "c" },
    ]);
    assert.deepEqual(failedLinkIds(r), [4, 3]);
    assert.deepEqual(failedLinkIds(of([], true)), []);
});

test("발송 + 미룸이면 defer다 — 미룬 규칙이 sent로 닫히면 안 된다 (W12)", () => {
    const r = of([{ kind: "sent", linkId: 1 }, deferred(2, "2026-10-03T00:00:00Z")]);
    assert.equal(foldOutcome(r), "defer");
});

test("skip + 미룸이면 defer다", () => {
    const r = of([{ kind: "skipped", linkId: 1, reason: "cooldown" }, deferred(2, "2026-10-03T00:00:00Z")]);
    assert.equal(foldOutcome(r), "defer");
});

test("규칙 미매칭이면 미룸이 섞여도 skip이고 deferredUntil은 null이다", () => {
    const r = of([deferred(1, "2026-10-03T00:00:00Z")], true);
    assert.equal(foldOutcome(r), "skip");
    assert.equal(deferredUntil(r), null);
});

test("deferredUntil은 미룸이 없으면 null이다", () => {
    assert.equal(deferredUntil(of([{ kind: "sent", linkId: 1 }])), null);
    assert.equal(deferredUntil(of([])), null);
});

test("deferredUntil은 가장 이른 시각과 그 이유를 돌려준다", () => {
    const r = of([
        deferred(1, "2026-10-05T00:00:00Z", "paused"),
        deferred(2, "2026-10-03T00:00:00Z", "daily_limit"),
        deferred(3, "2026-10-04T00:00:00Z", "spacing"),
    ]);
    const d = deferredUntil(r);
    assert.ok(d);
    assert.equal(d.retryAt.toISOString(), "2026-10-03T00:00:00.000Z");
    assert.equal(d.reason, "daily_limit");
});

test("deferredUntil은 실패가 섞여도 미룬 시각을 준다 — 바로 보내는 경로가 대기열에 넣어야 한다", () => {
    const r = of([{ kind: "failed", linkId: 1, error: "timeout" }, deferred(2, "2026-10-03T00:00:00Z", "spacing")]);
    assert.equal(deferredUntil(r)?.reason, "spacing");
});

test("deferredUntil이 준 시각을 고쳐도 원래 결과는 그대로다", () => {
    const r = of([deferred(1, "2026-10-03T00:00:00Z")]);
    const d = deferredUntil(r);
    assert.ok(d);
    d.retryAt.setTime(0);
    const o = r.outcomes[0];
    assert.ok(o.kind === "deferred");
    assert.equal(o.retryAt.toISOString(), "2026-10-03T00:00:00.000Z");
});

test("미룸을 사람이 읽게 적는다 (W12)", () => {
    const r = of([deferred(3, "2026-10-03T00:00:00Z")]);
    assert.equal(describeOutcome(r), "link 3: deferred (daily_limit) until 2026-10-03T00:00:00.000Z");
});

test("미룸을 섞어도 기존 문자열은 그대로다 (W12)", () => {
    const r = of([
        { kind: "sent", linkId: 1 },
        { kind: "skipped", linkId: 2, reason: "cooldown" },
        { kind: "failed", linkId: 7, error: "NHN 500" },
        deferred(4, "2026-10-03T00:00:00Z", "spacing"),
    ]);
    assert.equal(
        describeOutcome(r),
        "link 1: sent; link 2: skipped (cooldown); link 7: failed (NHN 500); link 4: deferred (spacing) until 2026-10-03T00:00:00.000Z",
    );
});
