import { test } from "node:test";
import assert from "node:assert";
import { effectsText, kindLabel, ruleStepText, syncBanner } from "./labels";
import type { ReplySyncStatus } from "../types";

const SYNC: ReplySyncStatus = {
    mode: "dry_run",
    requestedMode: "dry_run",
    alertMode: "dry_run",
    serverKind: "production",
    configured: true,
    mailboxMasked: "r***@matchesplan.com",
    lastRunAt: "2026-10-11T01:45:00.000Z",
    lastSuccessAt: "2026-10-11T01:45:00.000Z",
    errorCode: null,
    errorText: null,
    errorSince: null,
    backfillDone: true,
    excluded: [],
    warnings: [],
};

test("띠: 시험 모드·마지막 확인·가린 메일함", () => {
    const b = syncBanner(SYNC)!;
    assert.equal(b.tone, "warn");
    assert.match(b.title, /시험 모드\(dry_run\)/);
    assert.match(b.title, /10\. 11\.|10\/11|10월 11일/);
    assert.match(b.title, /r\*\*\*@matchesplan\.com/);
});

test("띠: 오류면 빨강, 뺀 주소 줄", () => {
    const b = syncBanner({ ...SYNC, errorCode: "auth", errorText: "메일함 연결이 끊겼습니다 — 갱신 토큰을 다시 받아 주세요", excluded: ["c***@matchesplan.com"] })!;
    assert.equal(b.tone, "error");
    assert.match(b.title, /메일함 연결이 끊겼습니다/);
    assert.match(b.lines[0], /뺀 주소 1개/);
});

test("띠: 연결 안 됨·표 없음", () => {
    assert.match(syncBanner({ ...SYNC, configured: false })!.title, /연결되지 않았습니다/);
    assert.match(syncBanner({ ...SYNC, tableMissing: true })!.title, /0074/);
    assert.equal(syncBanner(null), null);
});

test("분류 배지·규칙 단계 글자", () => {
    assert.deepEqual(kindLabel("human"), { label: "회신", tone: "green" });
    assert.equal(kindLabel("bounce").tone, "red");
    assert.equal(ruleStepText({ ruleKind: "ai", ruleName: "회계 첫 메일", ruleId: 3, stepIndex: 1, matchStatus: "matched" }), "AI · 회계 첫 메일 · 1번째 후속");
    assert.equal(ruleStepText({ ruleKind: "manual", ruleName: null, ruleId: null, stepIndex: 0, matchStatus: "matched" }), "직접 보낸 메일 · 첫 메일");
    assert.equal(ruleStepText({ ruleKind: null, ruleName: null, ruleId: null, stepIndex: null, matchStatus: "unmatched" }), "—");
});

test("효과 글자: on 멈춤 / dry_run 멈출 예정 / 기록만", () => {
    const base = { kind: "human", matchStatus: "matched", detectedMode: "on" };
    assert.equal(
        effectsText({ ...base, effectsAppliedAt: "2026-10-11T00:00:00Z", effects: { followupsCancelled: 1, automationCancelled: 0, sendQueueSkipped: 2 } }),
        "멈춤: 후속 1통 · 템플릿 0건 · 대기열 2건"
    );
    assert.match(effectsText({ ...base, effectsAppliedAt: null, effects: { preview: true, followupsCancelled: 1 } }), /^멈출 예정/);
    assert.match(effectsText({ ...base, kind: "auto_reply", effectsAppliedAt: null, effects: null }), /기록만/);
    assert.match(effectsText({ ...base, kind: "bounce", effectsAppliedAt: null, effects: { bounceSignalSkipped: "snd_tables_missing" } }), /반송 신호 대기/);
});
