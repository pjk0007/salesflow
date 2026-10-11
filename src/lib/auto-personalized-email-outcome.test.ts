import { test } from "node:test";
import assert from "node:assert";
import { foldOutcome, describeOutcome, type RecordOutcome } from "./auto-personalized-email-outcome";

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
