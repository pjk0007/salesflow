import { test } from "node:test";
import assert from "node:assert";
import { DEFAULT_LIMIT_SETTINGS, type SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import {
    applyWarmupToggle,
    changedLimitFields,
    checkLimitForm,
    inspectLimitForm,
    limitErrorField,
    limitFormFromSettings,
    limitFormToPatch,
    previewCells,
    spreadGapLabel,
    SUGGESTED_WARMUP_DAILY_LIMIT,
    todayKstYmd,
    warmupAutoFillNote,
    warmupDayNumber,
} from "./limitForm";

// 2026-10-01은 목요일, 10-02 금요일, 10-03 토요일, 10-05 월요일이다
const TODAY = "2026-10-02";

const WARMING: SenderLimitSettings = {
    ...DEFAULT_LIMIT_SETTINGS,
    dailyLimit: 50,
    warmupEnabled: true,
    warmupStartCount: 10,
    warmupStep: 5,
    warmupStartedOn: "2026-09-28",
    sendWindowStart: 9,
    sendWindowEnd: 18,
    weekdaysOnly: true,
};

function save(form: ReturnType<typeof limitFormFromSettings>, stored: SenderLimitSettings) {
    const check = checkLimitForm(form, stored, TODAY);
    assert.ok(check.ok, check.ok ? "" : check.error);
    return { value: check.value, patch: changedLimitFields(stored, check.value) };
}

// ── 바꾸지 않으면 한도 칸을 보내지 않는다 (멤버의 이름 수정이 관리자 확인에 걸리지 않게) ──

test("새 프로필에서 한도를 건드리지 않으면 보낼 한도 칸이 없다", () => {
    const { patch } = save(limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(patch, {});
});

test("저장된 한도를 그대로 열어 저장하면 보낼 칸이 없고 웜업 시작일도 그대로다", () => {
    const { value, patch } = save(limitFormFromSettings(WARMING), WARMING);
    assert.deepEqual(patch, {});
    assert.equal(value.warmupStartedOn, "2026-09-28");
});

// ── 바꾼 칸만 ──

test("웜업을 켜면 켠 칸과 채운 칸만 가고, 시작일은 보내지 않지만 미리보기 값에는 오늘로 잡힌다", () => {
    const form = { ...limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), dailyLimit: "50", warmupEnabled: true, warmupStartCount: "10", warmupStep: "5" };
    const { value, patch } = save(form, DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(patch, { dailyLimit: 50, warmupEnabled: true, warmupStartCount: 10, warmupStep: 5 });
    assert.equal(value.warmupStartedOn, TODAY);
});

test("시간대를 끄면 시작·끝을 함께 비운다", () => {
    const form = { ...limitFormFromSettings(WARMING), windowEnabled: false };
    const { patch } = save(form, WARMING);
    assert.deepEqual(patch, { sendWindowStart: null, sendWindowEnd: null });
});

test("하루 최대를 비우면 제한 없음(null)이다", () => {
    const stored = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 30 };
    const { patch } = save({ ...limitFormFromSettings(stored), dailyLimit: "  " }, stored);
    assert.deepEqual(patch, { dailyLimit: null });
});

test("웜업이 꺼져 있으면 숨겨진 첫날·증가 칸은 검사하지도 보내지도 않는다", () => {
    const form = { ...limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), warmupStartCount: "0" };
    assert.equal("warmupStartCount" in limitFormToPatch(form), false);
    const { patch } = save(form, DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(patch, {});
});

test("잘못된 조합은 저장 전에 막힌다 (하루 최대 없이 웜업)", () => {
    const form = { ...limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), warmupEnabled: true };
    const check = checkLimitForm(form, DEFAULT_LIMIT_SETTINGS, TODAY);
    assert.equal(check.ok, false);
});

test("시간대를 처음 켜면 9~18시가 채워져 있다", () => {
    const form = limitFormFromSettings(DEFAULT_LIMIT_SETTINGS);
    assert.equal(form.windowEnabled, false);
    assert.equal(form.sendWindowStart, 9);
    assert.equal(form.sendWindowEnd, 18);
});

// ── 미리보기·표시 ──

test("미리보기: 평일만이면 주말은 쉼, 웜업은 보낼 수 있는 날마다 오른다", () => {
    const s = { ...WARMING, warmupStartedOn: "2026-10-01" };
    const cells = previewCells(s, "2026-10-01", 5);
    assert.deepEqual(cells.map((c) => c.text), ["10통", "15통", "쉼", "쉼", "20통"]);
});

test("미리보기: 정지는 모든 날 정지, 한도가 없으면 무제한", () => {
    assert.deepEqual(previewCells({ ...WARMING, isPaused: true }, TODAY, 2).map((c) => c.text), ["정지", "정지"]);
    assert.deepEqual(previewCells({ ...DEFAULT_LIMIT_SETTINGS, weekdaysOnly: true }, TODAY, 2).map((c) => c.kind), ["unlimited", "off"]);
});

test("고르게 나누기 간격: 9~18시 54통이면 약 10분, 600통이면 약 54초", () => {
    const s = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 54, sendWindowStart: 9, sendWindowEnd: 18, spreadEvenly: true };
    assert.equal(spreadGapLabel(s, TODAY), "약 10분");
    assert.equal(spreadGapLabel({ ...s, dailyLimit: 600 }, TODAY), "약 54초");
    assert.equal(spreadGapLabel({ ...s, spreadEvenly: false }, TODAY), null);
});

test("웜업 날수는 시작일이 1일째다", () => {
    const s = { ...WARMING, weekdaysOnly: false, warmupStartedOn: TODAY };
    assert.equal(warmupDayNumber(s, TODAY), 1);
    assert.equal(warmupDayNumber(s, "2026-10-05"), 4);
    assert.equal(warmupDayNumber(DEFAULT_LIMIT_SETTINGS, TODAY), null);
});

test("오늘 날짜는 한국 시각으로 센다 (UTC 15:30 = 한국 다음 날 00:30)", () => {
    assert.equal(todayKstYmd(new Date("2026-10-01T15:30:00Z")), "2026-10-02");
});

// ── 웜업 스위치: 권장값 채우기와 되돌리기 ──

test("웜업을 켜면 빈 숫자 칸(하루 최대·첫날·증가)만 채워 스위치 하나로 저장할 수 있다", () => {
    const form = applyWarmupToggle(limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), true);
    assert.equal(form.dailyLimit, String(SUGGESTED_WARMUP_DAILY_LIMIT));
    assert.equal(form.warmupStartCount, "10");
    assert.equal(form.warmupStep, "5");
    const { patch } = save(form, DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(patch, {
        dailyLimit: 50,
        warmupEnabled: true,
        warmupStartCount: 10,
        warmupStep: 5,
    });
    assert.equal(warmupAutoFillNote(form), "하루 최대 50통");
});

test("웜업을 켜도 발송 시간대·평일만은 사용자가 고른 그대로 둔다 (언제 보내는가는 바꾸지 않는다)", () => {
    const off = applyWarmupToggle(limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), true);
    assert.equal(off.windowEnabled, false);
    assert.equal(off.weekdaysOnly, false);
    const stored = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 30, sendWindowStart: 10, sendWindowEnd: 16, weekdaysOnly: true };
    const on = applyWarmupToggle(limitFormFromSettings(stored), true);
    assert.equal(on.dailyLimit, "30");
    assert.deepEqual([on.windowEnabled, on.sendWindowStart, on.sendWindowEnd], [true, 10, 16]);
    assert.equal(on.weekdaysOnly, true);
    assert.equal(warmupAutoFillNote(on), null);
});

test("웜업을 다시 끄면 채운 칸 가운데 그대로인 것만 되돌린다", () => {
    const on = applyWarmupToggle(limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), true);
    const off = applyWarmupToggle(on, false);
    assert.equal(off.dailyLimit, "");
    assert.equal(off.windowEnabled, false);
    assert.equal(off.weekdaysOnly, false);
    assert.equal(off.warmupEnabled, false);
    assert.deepEqual(changedLimitFields(DEFAULT_LIMIT_SETTINGS, save(off, DEFAULT_LIMIT_SETTINGS).value), {});
    // 사용자가 고친 하루 최대는 남긴다
    const edited = { ...on, dailyLimit: "30" };
    assert.equal(applyWarmupToggle(edited, false).dailyLimit, "30");
    assert.equal(warmupAutoFillNote(edited), null);
});

test("고르게 나누기가 켜져 있으면 웜업을 꺼도 그것이 기대는 하루 최대·시간대는 남긴다", () => {
    const on = { ...applyWarmupToggle(limitFormFromSettings(DEFAULT_LIMIT_SETTINGS), true), windowEnabled: true, spreadEvenly: true };
    const off = applyWarmupToggle(on, false);
    assert.equal(off.dailyLimit, "50");
    assert.equal(off.windowEnabled, true);
    assert.ok(checkLimitForm(off, DEFAULT_LIMIT_SETTINGS, TODAY).ok);
});

// ── 오류를 붙일 칸: 저장을 누르기 전에 그 칸 바로 아래에 보인다 ──

test("잘못된 조합마다 오류가 고칠 칸에 붙는다", () => {
    const base = limitFormFromSettings(DEFAULT_LIMIT_SETTINGS);
    const cases: Array<[string, ReturnType<typeof limitFormFromSettings>, string]> = [
        ["웜업 켬 + 하루 최대 비움", { ...base, warmupEnabled: true, warmupStartCount: "10", warmupStep: "5" }, "dailyLimit"],
        ["시간대 18시→9시", { ...base, windowEnabled: true, sendWindowStart: 18, sendWindowEnd: 9 }, "window"],
        ["시간대 10시→10시", { ...base, windowEnabled: true, sendWindowStart: 10, sendWindowEnd: 10 }, "window"],
        ["시간대 없이 고르게", { ...base, dailyLimit: "50", spreadEvenly: true }, "spreadEvenly"],
        ["하루 최대 1000000", { ...base, dailyLimit: "1000000" }, "dailyLimit"],
        ["하루 최대 -5", { ...base, dailyLimit: "-5" }, "dailyLimit"],
        ["하루 최대 2.5", { ...base, dailyLimit: "2.5" }, "dailyLimit"],
        ["하루 증가 -3", { ...base, dailyLimit: "50", warmupEnabled: true, warmupStartCount: "10", warmupStep: "-3" }, "warmupStep"],
        ["첫날 0", { ...base, dailyLimit: "50", warmupEnabled: true, warmupStartCount: "0", warmupStep: "5" }, "warmupStartCount"],
        ["한도 없이 고르게", { ...base, windowEnabled: true, spreadEvenly: true }, "spreadEvenly"],
    ];
    for (const [name, form, field] of cases) {
        const r = inspectLimitForm(form, DEFAULT_LIMIT_SETTINGS, TODAY);
        assert.equal(r.ok, false, name);
        if (!r.ok) assert.equal(r.field, field, `${name}: ${r.error}`);
    }
});

test("칸을 특정하지 못한 문구는 general", () => {
    assert.equal(limitErrorField("일시 정지는 true 또는 false여야 합니다."), "general");
});
