import { test } from "node:test";
import assert from "node:assert";
import {
    capForDate,
    capSchedule,
    decideSlot,
    describeDeferral,
    hasAnyLimit,
    isSendableNow,
    linkSenderPool,
    nextSendableAt,
    normalizeSenderPool,
    poolSpacingStepMs,
    rankPool,
    spreadGapMs,
    spreadSpacingRetry,
    toLimitSettings,
    validateLimitSettings,
    warmupDayIndex,
    DEFAULT_LIMIT_SETTINGS,
    DEFAULT_RESUME_HOUR,
    DEFAULT_WARMUP_START,
    DEFAULT_WARMUP_STEP,
    MAX_SENDER_POOL_INPUT,
    MAX_SENDER_POOL_SIZE,
    type PoolCandidate,
    type SenderLimitSettings,
    type SlotDecision,
    type SpacingSpreadMemo,
} from "./email-sender-limit-rules";
import { kstParts, kstToDate } from "./kst";

// 2026-10-01은 목요일, 10-02 금요일, 10-03 토요일, 10-04 일요일, 10-05 월요일이다

/** 한국 시각 "2026-10-05T08:59" → Date */
const at = (kst: string): Date => new Date(`${kst}:00+09:00`);
const iso = (kst: string): string => at(kst).toISOString();
const settings = (over: Partial<SenderLimitSettings> = {}): SenderLimitSettings => ({
    ...DEFAULT_LIMIT_SETTINGS,
    ...over,
});
const NO_USAGE: PoolCandidate["usage"] = { sentToday: 0, lastSentAt: null };

function deferredOf(d: SlotDecision): { retryAt: string; reason: string } {
    assert.equal(d.ok, false, "막혀야 하는데 통과했다");
    if (d.ok) throw new Error("unreachable");
    return { retryAt: d.retryAt.toISOString(), reason: d.reason };
}

const WINDOW_9_18 = { sendWindowStart: 9, sendWindowEnd: 18 };

// ── W1: 한도가 하나도 없으면 지금과 똑같다 ──

test("기본 설정은 한도가 없고 언제든 바로 보낸다 (W1)", () => {
    const s = settings();
    assert.equal(hasAnyLimit(s), false);
    assert.equal(capForDate(s, "2026-10-04"), null);
    assert.equal(spreadGapMs(s, null), 0);
    // 일요일 새벽 3시, 오늘 많이 보냈어도 막지 않는다
    const sunday3am = at("2026-10-04T03:00");
    assert.deepEqual(decideSlot(s, sunday3am, { sentToday: 99999, lastSentAt: sunday3am }), { ok: true });
    assert.equal(isSendableNow(s, sunday3am), true);
});

test("빈 행·없는 행은 기본 설정이 된다 (W1)", () => {
    assert.deepEqual(toLimitSettings(null), DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(toLimitSettings(undefined), DEFAULT_LIMIT_SETTINGS);
    assert.deepEqual(toLimitSettings({}), DEFAULT_LIMIT_SETTINGS);
    // 고쳐도 기본값이 바뀌지 않게 새 객체를 준다
    assert.notEqual(toLimitSettings(null), DEFAULT_LIMIT_SETTINGS);
    assert.equal(Object.isFrozen(DEFAULT_LIMIT_SETTINGS), true);
});

test("한도 칸 하나만 켜도 hasAnyLimit이다", () => {
    assert.equal(hasAnyLimit(settings({ isPaused: true })), true);
    assert.equal(hasAnyLimit(settings({ dailyLimit: 100 })), true);
    assert.equal(hasAnyLimit(settings({ warmupEnabled: true })), true);
    assert.equal(hasAnyLimit(settings(WINDOW_9_18)), true);
    assert.equal(hasAnyLimit(settings({ weekdaysOnly: true })), true);
    // 고르게 나누기는 한도·시간대 없이 혼자서는 아무것도 막지 않는다
    assert.equal(hasAnyLimit(settings({ spreadEvenly: true })), false);
});

test("한도 없는 묶음은 묶음 순서 그대로다 — 주소가 하나면 그 주소다 (W1)", () => {
    const now = at("2026-10-01T10:00");
    const open = (id: number): PoolCandidate => ({ id, settings: settings(), usage: NO_USAGE });
    assert.deepEqual(rankPool([open(7)], now), { ok: true, order: [7] });
    assert.deepEqual(rankPool([open(3), open(1), open(2)], now), { ok: true, order: [3, 1, 2] });
});

// ── W2: 웜업 ──

const WARMUP_10_5 = settings({
    warmupEnabled: true,
    warmupStartCount: 10,
    warmupStep: 5,
    dailyLimit: 50,
    warmupStartedOn: "2026-10-01",
});

test("웜업 10/5, 하루 최대 50: 0일째 10, 3일째 25, 8일째 50, 20일째 50 (W2)", () => {
    assert.equal(capForDate(WARMUP_10_5, "2026-10-01"), 10);
    assert.equal(capForDate(WARMUP_10_5, "2026-10-04"), 25);
    assert.equal(capForDate(WARMUP_10_5, "2026-10-08"), 45);
    assert.equal(capForDate(WARMUP_10_5, "2026-10-09"), 50);
    assert.equal(capForDate(WARMUP_10_5, "2026-10-21"), 50);
    assert.equal(warmupDayIndex(WARMUP_10_5, "2026-10-21"), 20);
});

test("시작일보다 이른 날은 0일째다", () => {
    assert.equal(warmupDayIndex(WARMUP_10_5, "2026-09-30"), 0);
    assert.equal(capForDate(WARMUP_10_5, "2026-09-30"), 10);
});

test("첫날·증가 수가 비어 있으면 기본값 10/5를 쓴다", () => {
    assert.equal(DEFAULT_WARMUP_START, 10);
    assert.equal(DEFAULT_WARMUP_STEP, 5);
    const s = settings({ ...WARMUP_10_5, warmupStartCount: null, warmupStep: null });
    assert.equal(capForDate(s, "2026-10-01"), 10);
    assert.equal(capForDate(s, "2026-10-03"), 20);
});

test("웜업이 켜졌는데 시작일이 없으면 그날을 0일째로 본다", () => {
    const s = settings({ ...WARMUP_10_5, warmupStartedOn: null });
    assert.equal(warmupDayIndex(s, "2026-10-09"), 0);
    assert.equal(capForDate(s, "2026-10-09"), 10);
});

test("웜업이 꺼져 있으면 하루 최대만 본다", () => {
    const s = settings({ ...WARMUP_10_5, warmupEnabled: false });
    assert.equal(capForDate(s, "2026-10-01"), 50);
});

test("하루 최대 없이 저장된 웜업(옛 값)도 한도 없음이 되지는 않는다", () => {
    const s = settings({ ...WARMUP_10_5, dailyLimit: null });
    assert.equal(capForDate(s, "2026-10-03"), 20);
});

test("capSchedule은 달을 넘겨 날마다 한도를 준다", () => {
    const s = settings({ ...WARMUP_10_5, warmupStartedOn: "2026-10-25" });
    const rows = capSchedule(s, "2026-10-25", 14);
    assert.equal(rows.length, 14);
    assert.deepEqual(rows[0], { date: "2026-10-25", cap: 10 });
    assert.deepEqual(rows[7], { date: "2026-11-01", cap: 45 });
    assert.deepEqual(rows[13], { date: "2026-11-07", cap: 50 });
});

test("capSchedule은 잘못된 입력에 빈 목록을 준다", () => {
    assert.deepEqual(capSchedule(WARMUP_10_5, "2026-10-01", 0), []);
    assert.deepEqual(capSchedule(WARMUP_10_5, "not-a-date", 14), []);
    assert.deepEqual(capSchedule(WARMUP_10_5, "2026-02-30", 14), []);
});

// ── W3: 평일만 + 웜업 ──

const WEEKDAY_WARMUP = settings({
    warmupEnabled: true,
    warmupStartCount: 10,
    warmupStep: 5,
    dailyLimit: 100,
    warmupStartedOn: "2026-10-05",
    weekdaysOnly: true,
});

test("평일만 + 웜업: 금 → 월은 한 단계만 오른다 (W3)", () => {
    assert.equal(capForDate(WEEKDAY_WARMUP, "2026-10-09"), 30); // 금, 4일째
    assert.equal(capForDate(WEEKDAY_WARMUP, "2026-10-12"), 35); // 월, 5일째
    assert.equal(warmupDayIndex(WEEKDAY_WARMUP, "2026-10-12"), 5);
});

test("평일만이면 주말 한도는 0이다 — 그날은 못 보낸다", () => {
    assert.equal(capForDate(WEEKDAY_WARMUP, "2026-10-10"), 0);
    assert.equal(capForDate(WEEKDAY_WARMUP, "2026-10-11"), 0);
    // 웜업 날수는 그대로 다음 월요일 값이다
    assert.equal(warmupDayIndex(WEEKDAY_WARMUP, "2026-10-10"), 5);
});

test("토요일에 켜면 월요일이 0일째다", () => {
    const s = settings({ ...WEEKDAY_WARMUP, warmupStartedOn: "2026-10-03" });
    assert.equal(warmupDayIndex(s, "2026-10-05"), 0);
    assert.equal(warmupDayIndex(s, "2026-10-06"), 1);
});

test("평일만 날수는 여러 주에 걸쳐도 평일만 센다", () => {
    assert.equal(warmupDayIndex(WEEKDAY_WARMUP, "2026-11-02"), 20); // 4주 뒤 월요일
    assert.equal(warmupDayIndex(WEEKDAY_WARMUP, "2026-11-05"), 23); // + 월·화·수
    const fri = settings({ ...WEEKDAY_WARMUP, warmupStartedOn: "2026-10-02" });
    assert.equal(warmupDayIndex(fri, "2026-10-10"), 6); // 금, 월~금
    // 평일만이 아니면 달력 날수다
    assert.equal(warmupDayIndex(settings({ ...fri, weekdaysOnly: false }), "2026-10-05"), 3);
});

// ── W4: 일시 정지 ──

test("정지면 한도 0, paused, 다음 보낼 수 있는 날 시작으로 (W4)", () => {
    const s = settings({ isPaused: true, ...WINDOW_9_18 });
    assert.equal(capForDate(s, "2026-10-01"), 0);
    assert.equal(hasAnyLimit(s), true);
    assert.deepEqual(deferredOf(decideSlot(s, at("2026-10-01T10:00"), NO_USAGE)), {
        retryAt: iso("2026-10-02T09:00"),
        reason: "paused",
    });
});

test("정지는 시간대 밖보다 먼저 본다", () => {
    const s = settings({ isPaused: true, ...WINDOW_9_18 });
    assert.equal(deferredOf(decideSlot(s, at("2026-10-01T03:00"), NO_USAGE)).reason, "paused");
});

test("시간대 없이 정지하면 다음 날 09:00, 평일만이면 금 → 월 (W4)", () => {
    assert.equal(DEFAULT_RESUME_HOUR, 9);
    assert.equal(
        deferredOf(decideSlot(settings({ isPaused: true }), at("2026-10-01T10:00"), NO_USAGE)).retryAt,
        iso("2026-10-02T09:00"),
    );
    assert.equal(
        deferredOf(decideSlot(settings({ isPaused: true, weekdaysOnly: true }), at("2026-10-02T10:00"), NO_USAGE))
            .retryAt,
        iso("2026-10-05T09:00"),
    );
});

// ── W5: 시간대 ──

test("시간대 9~18: 08:59 → 그날 09:00 (W5)", () => {
    const s = settings(WINDOW_9_18);
    assert.equal(isSendableNow(s, at("2026-10-05T08:59")), false);
    assert.deepEqual(deferredOf(decideSlot(s, at("2026-10-05T08:59"), NO_USAGE)), {
        retryAt: iso("2026-10-05T09:00"),
        reason: "outside_window",
    });
});

test("시간대 9~18: 09:00·17:59는 보내고 18:00은 다음 날 09:00 (W5)", () => {
    const s = settings(WINDOW_9_18);
    assert.deepEqual(decideSlot(s, at("2026-10-05T09:00"), NO_USAGE), { ok: true });
    assert.deepEqual(decideSlot(s, at("2026-10-05T17:59"), NO_USAGE), { ok: true });
    assert.equal(deferredOf(decideSlot(s, at("2026-10-05T18:00"), NO_USAGE)).retryAt, iso("2026-10-06T09:00"));
});

test("평일만이면 금 18:00 → 월 09:00, 토요일 낮 → 월 09:00 (W5)", () => {
    const s = settings({ ...WINDOW_9_18, weekdaysOnly: true });
    assert.equal(deferredOf(decideSlot(s, at("2026-10-02T18:00"), NO_USAGE)).retryAt, iso("2026-10-05T09:00"));
    assert.equal(deferredOf(decideSlot(s, at("2026-10-03T11:00"), NO_USAGE)).retryAt, iso("2026-10-05T09:00"));
});

test("시간대 없이 평일만이면 주말은 월요일 09:00으로 — 자정에 몰려 나가지 않는다", () => {
    const s = settings({ weekdaysOnly: true });
    assert.deepEqual(deferredOf(decideSlot(s, at("2026-10-04T15:00"), NO_USAGE)), {
        retryAt: iso("2026-10-05T09:00"),
        reason: "outside_window",
    });
    assert.deepEqual(decideSlot(s, at("2026-10-05T02:00"), NO_USAGE), { ok: true });
});

test("시간대 끝이 24시면 자정 직전까지 보내고, 자정 뒤에는 그날 시작까지 기다린다", () => {
    const s = settings({ sendWindowStart: 18, sendWindowEnd: 24 });
    assert.equal(isSendableNow(s, at("2026-10-01T23:59")), true);
    assert.equal(isSendableNow(s, at("2026-10-02T00:00")), false);
    assert.equal(deferredOf(decideSlot(s, at("2026-10-02T00:00"), NO_USAGE)).retryAt, iso("2026-10-02T18:00"));
    assert.equal(deferredOf(decideSlot(s, at("2026-10-01T17:59"), NO_USAGE)).retryAt, iso("2026-10-01T18:00"));
});

test("nextSendableAt은 늘 새 Date를 준다", () => {
    const now = at("2026-10-01T10:00");
    const s = settings(WINDOW_9_18);
    const next = nextSendableAt(s, now);
    assert.notEqual(next, now);
    assert.equal(next.getTime(), now.getTime());
    assert.notEqual(nextSendableAt(settings(), now), now);
});

// ── W6: 오늘 한도 ──

test("오늘 보낸 수 = 한도면 daily_limit, 다음 날 시작으로 (W6)", () => {
    const s = settings({ dailyLimit: 20, ...WINDOW_9_18 });
    const now = at("2026-10-01T10:00");
    assert.deepEqual(decideSlot(s, now, { sentToday: 19, lastSentAt: null }), { ok: true });
    assert.deepEqual(deferredOf(decideSlot(s, now, { sentToday: 20, lastSentAt: null })), {
        retryAt: iso("2026-10-02T09:00"),
        reason: "daily_limit",
    });
    assert.equal(deferredOf(decideSlot(s, now, { sentToday: 25, lastSentAt: null })).reason, "daily_limit");
});

test("시간대 없는 한도는 다음 날 09:00, 평일만이면 금 → 월", () => {
    assert.equal(
        deferredOf(decideSlot(settings({ dailyLimit: 20 }), at("2026-10-01T23:30"), { sentToday: 20, lastSentAt: null }))
            .retryAt,
        iso("2026-10-02T09:00"),
    );
    assert.equal(
        deferredOf(
            decideSlot(settings({ dailyLimit: 20, weekdaysOnly: true }), at("2026-10-02T15:00"), {
                sentToday: 20,
                lastSentAt: null,
            }),
        ).retryAt,
        iso("2026-10-05T09:00"),
    );
});

test("한국 자정에 한도 날짜가 바뀐다 — UTC 날짜가 아니다", () => {
    // UTC 2026-10-01T14:59 = KST 10/1 23:59 (0일째, 10통), UTC 15:00 = KST 10/2 00:00 (1일째, 15통)
    const s = settings({ ...WARMUP_10_5 });
    const beforeMidnight = new Date("2026-10-01T14:59:00Z");
    const afterMidnight = new Date("2026-10-01T15:00:00Z");
    assert.deepEqual(deferredOf(decideSlot(s, beforeMidnight, { sentToday: 10, lastSentAt: null })), {
        retryAt: iso("2026-10-02T09:00"),
        reason: "daily_limit",
    });
    assert.deepEqual(decideSlot(s, afterMidnight, { sentToday: 10, lastSentAt: null }), { ok: true });
});

test("시간대 0~24에서 한도를 다 쓰면 다음 날 00:00이다", () => {
    const s = settings({ dailyLimit: 5, sendWindowStart: 0, sendWindowEnd: 24 });
    assert.equal(
        deferredOf(decideSlot(s, at("2026-10-01T23:59"), { sentToday: 5, lastSentAt: null })).retryAt,
        "2026-10-01T15:00:00.000Z",
    );
});

// ── W7: 고르게 나눠 보내기 ──

const SPREAD_54 = settings({ dailyLimit: 54, ...WINDOW_9_18, spreadEvenly: true });

test("고르게: 9~18, 한도 54 → 10분, 한도 600 → 54초 (0이 되지 않음) (W7)", () => {
    assert.equal(spreadGapMs(SPREAD_54, 54), 10 * 60 * 1000);
    assert.equal(spreadGapMs(SPREAD_54, 600), 54 * 1000);
    assert.equal(spreadGapMs(SPREAD_54, 100000), 324);
});

test("고르게 나누기는 꺼짐·한도 없음·한도 0·시간대 없음이면 간격이 없다", () => {
    assert.equal(spreadGapMs(settings({ ...SPREAD_54, spreadEvenly: false }), 54), 0);
    assert.equal(spreadGapMs(SPREAD_54, null), 0);
    assert.equal(spreadGapMs(SPREAD_54, 0), 0);
    assert.equal(spreadGapMs(settings({ dailyLimit: 54, spreadEvenly: true }), 54), 0);
});

test("간격 안이면 spacing으로 간격 끝까지, 지나면 보낸다 (W7)", () => {
    const last = at("2026-10-01T10:00");
    assert.deepEqual(deferredOf(decideSlot(SPREAD_54, at("2026-10-01T10:05"), { sentToday: 1, lastSentAt: last })), {
        retryAt: iso("2026-10-01T10:10"),
        reason: "spacing",
    });
    assert.deepEqual(decideSlot(SPREAD_54, at("2026-10-01T10:10"), { sentToday: 1, lastSentAt: last }), { ok: true });
    // 오늘 처음이면 간격을 보지 않는다
    assert.deepEqual(decideSlot(SPREAD_54, at("2026-10-01T10:05"), NO_USAGE), { ok: true });
});

test("웜업 중에는 그날 웜업 한도로 간격을 나눈다", () => {
    // 0일째 10통 → 9시간 / 10 = 54분
    const s = settings({ ...WARMUP_10_5, ...WINDOW_9_18, spreadEvenly: true });
    const d = decideSlot(s, at("2026-10-01T10:30"), { sentToday: 1, lastSentAt: at("2026-10-01T10:00") });
    assert.equal(deferredOf(d).retryAt, iso("2026-10-01T10:54"));
});

// ── W8: 간격이 시간대를 넘으면 다음 날 ──

test("간격 retryAt이 시간대 끝을 넘으면 다음 날 시작 (W8)", () => {
    const d = decideSlot(SPREAD_54, at("2026-10-01T17:58"), { sentToday: 30, lastSentAt: at("2026-10-01T17:55") });
    assert.deepEqual(deferredOf(d), { retryAt: iso("2026-10-02T09:00"), reason: "spacing" });
});

test("간격이 정확히 시간대 끝에 닿아도 다음 날 시작이다", () => {
    const d = decideSlot(SPREAD_54, at("2026-10-01T17:55"), { sentToday: 30, lastSentAt: at("2026-10-01T17:50") });
    assert.equal(deferredOf(d).retryAt, iso("2026-10-02T09:00"));
});

test("평일만이면 금요일 간격이 넘친 것은 월요일 시작으로 (W8)", () => {
    const s = settings({ ...SPREAD_54, weekdaysOnly: true });
    const d = decideSlot(s, at("2026-10-02T17:58"), { sentToday: 30, lastSentAt: at("2026-10-02T17:55") });
    assert.equal(deferredOf(d).retryAt, iso("2026-10-05T09:00"));
});

test("시간대 끝이 24시이고 간격이 자정을 넘으면 다음 날 시작이다", () => {
    // 18~24시, 한도 6 → 1시간 간격. 23:30에 보냈으면 00:30이지만 날이 바뀌면 사용량이 새로 시작한다
    const s = settings({ dailyLimit: 6, sendWindowStart: 18, sendWindowEnd: 24, spreadEvenly: true });
    const d = decideSlot(s, at("2026-10-01T23:40"), { sentToday: 3, lastSentAt: at("2026-10-01T23:30") });
    assert.equal(deferredOf(d).retryAt, iso("2026-10-02T18:00"));
});

// ── W9: 묶음 ──

const NOW = at("2026-10-01T10:05");
const cand = (id: number, over: Partial<SenderLimitSettings> = {}, usage = NO_USAGE): PoolCandidate => ({
    id,
    settings: settings(over),
    usage,
});

test("묶음: 통과한 주소 중 가장 오래 쉰 주소 먼저, 오늘 안 보낸 주소가 맨 앞 (W9)", () => {
    const r = rankPool(
        [
            cand(1, {}, { sentToday: 3, lastSentAt: at("2026-10-01T10:00") }),
            cand(2, {}, NO_USAGE),
            cand(3, {}, { sentToday: 5, lastSentAt: at("2026-10-01T09:00") }),
        ],
        NOW,
    );
    assert.deepEqual(r, { ok: true, order: [2, 3, 1] });
});

test("묶음: 쉰 시간이 같으면 묶음 순서다", () => {
    const same = { sentToday: 1, lastSentAt: at("2026-10-01T09:00") };
    assert.deepEqual(rankPool([cand(5, {}, same), cand(4, {}, same)], NOW), { ok: true, order: [5, 4] });
});

test("묶음: 막힌 주소는 빼고 나머지로 (W9)", () => {
    const r = rankPool([cand(1, { dailyLimit: 5 }, { sentToday: 5, lastSentAt: null }), cand(2)], NOW);
    assert.deepEqual(r, { ok: true, order: [2] });
});

test("묶음: 전부 막히면 정지 아닌 주소의 가장 이른 시각과 그 이유 (W9)", () => {
    const r = rankPool(
        [
            cand(1, { dailyLimit: 5, ...WINDOW_9_18 }, { sentToday: 5, lastSentAt: null }), // 내일 09:00
            cand(2, { sendWindowStart: 13, sendWindowEnd: 18 }), // 오늘 13:00
            cand(3, { isPaused: true, sendWindowStart: 0, sendWindowEnd: 24 }), // 내일 00:00 (정지)
        ],
        NOW,
    );
    assert.deepEqual(r, { ok: false, retryAt: at("2026-10-01T13:00"), reason: "outside_window" });
});

test("묶음: 정지한 주소의 시각이 더 일러도 쓰지 않는다 (W9)", () => {
    const r = rankPool(
        [
            cand(1, { dailyLimit: 5, ...WINDOW_9_18 }, { sentToday: 5, lastSentAt: null }), // 내일 09:00
            cand(3, { isPaused: true, sendWindowStart: 0, sendWindowEnd: 24 }), // 내일 00:00 (정지)
        ],
        NOW,
    );
    assert.deepEqual(r, { ok: false, retryAt: at("2026-10-02T09:00"), reason: "daily_limit" });
});

test("묶음: 전부 정지면 가장 이른 시각, paused", () => {
    const r = rankPool(
        [cand(1, { isPaused: true, ...WINDOW_9_18 }), cand(2, { isPaused: true, sendWindowStart: 0, sendWindowEnd: 24 })],
        NOW,
    );
    assert.deepEqual(r, { ok: false, retryAt: at("2026-10-02T00:00"), reason: "paused" });
});

test("묶음: 같은 시각이면 묶음 앞쪽의 이유를 남긴다", () => {
    // 17:58에 2번은 간격 끝이 18:05라 시간대 밖 → 내일 09:00 spacing, 1번은 한도 → 내일 09:00 daily_limit
    const r = rankPool(
        [
            cand(2, SPREAD_54, { sentToday: 30, lastSentAt: at("2026-10-01T17:55") }),
            cand(1, { dailyLimit: 5, ...WINDOW_9_18 }, { sentToday: 5, lastSentAt: null }),
        ],
        at("2026-10-01T17:58"),
    );
    assert.deepEqual(r, { ok: false, retryAt: at("2026-10-02T09:00"), reason: "spacing" });
});

test("묶음: 후보가 없으면 고를 게 없을 뿐 막힌 것이 아니다", () => {
    assert.deepEqual(rankPool([], NOW), { ok: true, order: [] });
});

test("묶음: 같은 id는 한 번만 센다", () => {
    assert.deepEqual(rankPool([cand(1), cand(2), cand(1)], NOW), { ok: true, order: [1, 2] });
});

// ── 간격 미룸 펼치기 (대기열 몰림 방지) ──

const TEN_MIN = 10 * 60 * 1000;

test("poolSpacingStepMs: 주소 하나가 간격에 막히면 그 간격이다", () => {
    const c = cand(1, SPREAD_54, { sentToday: 3, lastSentAt: at("2026-10-01T10:00") });
    assert.equal(poolSpacingStepMs([c], NOW), TEN_MIN);
});

test("poolSpacingStepMs: 주소 둘이 각자 10분 간격이면 묶음은 5분마다 한 통이다", () => {
    const r = poolSpacingStepMs(
        [
            cand(1, SPREAD_54, { sentToday: 3, lastSentAt: at("2026-10-01T10:00") }),
            cand(2, SPREAD_54, { sentToday: 3, lastSentAt: at("2026-10-01T10:03") }),
        ],
        NOW,
    );
    assert.equal(r, TEN_MIN / 2);
});

test("poolSpacingStepMs: 한도·정지에 막힌 주소와 같은 id 중복은 묶음 속도에 넣지 않는다", () => {
    const r = poolSpacingStepMs(
        [
            cand(1, SPREAD_54, { sentToday: 3, lastSentAt: at("2026-10-01T10:00") }),
            cand(1, SPREAD_54, { sentToday: 3, lastSentAt: at("2026-10-01T10:00") }),
            cand(2, { dailyLimit: 5, ...WINDOW_9_18 }, { sentToday: 5, lastSentAt: null }),
            cand(3, { isPaused: true }),
        ],
        NOW,
    );
    assert.equal(r, TEN_MIN);
});

test("poolSpacingStepMs: 간격이 시간대 끝을 넘겨 다음 날로 밀렸거나 막히지 않았으면 0이다 (펼치지 않음)", () => {
    // W8과 같은 경우 — 다음 날 시작으로 미룬 것은 오늘 묶음 속도가 아니다
    const late = cand(1, SPREAD_54, { sentToday: 30, lastSentAt: at("2026-10-01T17:55") });
    assert.equal(poolSpacingStepMs([late], at("2026-10-01T17:58")), 0);
    assert.equal(poolSpacingStepMs([cand(2, SPREAD_54)], NOW), 0);
    assert.equal(poolSpacingStepMs([], NOW), 0);
});

test("spreadSpacingRetry: 같은 묶음·같은 retryAt이면 순번 × 간격으로 펼친다", () => {
    const memo: SpacingSpreadMemo = new Map();
    const retryAt = at("2026-10-01T10:10");
    const got = [0, 1, 2].map(() => spreadSpacingRetry(memo, "1", retryAt, TEN_MIN, NOW).toISOString());
    assert.deepEqual(got, [iso("2026-10-01T10:10"), iso("2026-10-01T10:20"), iso("2026-10-01T10:30")]);
    // 넘겨준 retryAt은 그대로다 (늘 새 Date)
    assert.equal(retryAt.toISOString(), iso("2026-10-01T10:10"));
});

test("spreadSpacingRetry: 다른 묶음이나 다른 retryAt은 따로 센다", () => {
    const memo: SpacingSpreadMemo = new Map();
    const r1 = at("2026-10-01T10:10");
    spreadSpacingRetry(memo, "1", r1, TEN_MIN, NOW);
    assert.equal(spreadSpacingRetry(memo, "1,2", r1, TEN_MIN, NOW).toISOString(), iso("2026-10-01T10:10"));
    // 한 통이 나가 마지막 발송이 바뀌면 retryAt도 바뀐다 — 그 시각의 첫 줄은 정확히 그때 깨어난다
    assert.equal(
        spreadSpacingRetry(memo, "1", at("2026-10-01T10:12"), TEN_MIN, NOW).toISOString(),
        iso("2026-10-01T10:12"),
    );
});

test("spreadSpacingRetry: 지난 retryAt의 기록은 버린다 — 쌓이지 않는다", () => {
    const memo: SpacingSpreadMemo = new Map();
    spreadSpacingRetry(memo, "1", at("2026-10-01T10:10"), TEN_MIN, NOW);
    spreadSpacingRetry(memo, "1", at("2026-10-01T10:10"), TEN_MIN, NOW);
    assert.equal(memo.size, 1);
    spreadSpacingRetry(memo, "1", at("2026-10-01T10:25"), TEN_MIN, at("2026-10-01T10:15"));
    assert.deepEqual([...memo.values()].map((e) => e.baseMs), [at("2026-10-01T10:25").getTime()]);
});

test("spreadSpacingRetry: 간격이 0이거나 retryAt이 지금보다 이르면 그대로 준다", () => {
    const memo: SpacingSpreadMemo = new Map();
    const r = at("2026-10-01T10:10");
    assert.equal(spreadSpacingRetry(memo, "1", r, 0, NOW).toISOString(), r.toISOString());
    assert.equal(spreadSpacingRetry(memo, "1", r, 0, NOW).toISOString(), r.toISOString());
    assert.equal(spreadSpacingRetry(memo, "1", NOW, TEN_MIN, NOW).toISOString(), NOW.toISOString());
    assert.equal(memo.size, 0);
});

// ── W10: 저장 검증 ──

const TODAY = "2026-10-02";

function okValue(r: ReturnType<typeof validateLimitSettings>): SenderLimitSettings {
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) throw new Error("unreachable");
    return r.value;
}

function errorOf(r: ReturnType<typeof validateLimitSettings>): string {
    assert.equal(r.ok, false, "오류여야 하는데 통과했다");
    if (r.ok) throw new Error("unreachable");
    return r.error;
}

test("참거짓: \"false\"·\"0\"·0은 거짓, \"true\"·\"1\"·1은 참 (W10)", () => {
    const cur = settings();
    assert.equal(okValue(validateLimitSettings({ isPaused: "false" }, cur, TODAY)).isPaused, false);
    assert.equal(okValue(validateLimitSettings({ weekdaysOnly: "0" }, cur, TODAY)).weekdaysOnly, false);
    assert.equal(okValue(validateLimitSettings({ weekdaysOnly: 0 }, cur, TODAY)).weekdaysOnly, false);
    assert.equal(okValue(validateLimitSettings({ isPaused: "true" }, cur, TODAY)).isPaused, true);
    assert.equal(okValue(validateLimitSettings({ isPaused: "1" }, cur, TODAY)).isPaused, true);
    assert.equal(okValue(validateLimitSettings({ isPaused: 1 }, cur, TODAY)).isPaused, true);
    // 켜진 값을 "false"로 끈다
    const paused = settings({ isPaused: true });
    assert.equal(okValue(validateLimitSettings({ isPaused: "false" }, paused, TODAY)).isPaused, false);
});

test("참거짓: 정해진 여섯 값 말고는 오류다", () => {
    for (const bad of ["yes", "TRUE", "", null, 2, -1, [], {}]) {
        assert.equal(errorOf(validateLimitSettings({ isPaused: bad }, settings(), TODAY)), "일시 정지는 true 또는 false여야 합니다.");
    }
    assert.equal(
        errorOf(validateLimitSettings({ warmupEnabled: "on" }, settings(), TODAY)),
        "웜업 사용은 true 또는 false여야 합니다.",
    );
});

test("숫자: 정수와 숫자 문자열만, null·\"\"은 비움", () => {
    const cur = settings({ dailyLimit: 30 });
    assert.equal(okValue(validateLimitSettings({ dailyLimit: 50 }, cur, TODAY)).dailyLimit, 50);
    assert.equal(okValue(validateLimitSettings({ dailyLimit: "50" }, cur, TODAY)).dailyLimit, 50);
    assert.equal(okValue(validateLimitSettings({ dailyLimit: " 50 " }, cur, TODAY)).dailyLimit, 50);
    assert.equal(okValue(validateLimitSettings({ dailyLimit: "" }, cur, TODAY)).dailyLimit, null);
    assert.equal(okValue(validateLimitSettings({ dailyLimit: null }, cur, TODAY)).dailyLimit, null);
    // 칸이 없으면 현재 값 그대로
    assert.equal(okValue(validateLimitSettings({}, cur, TODAY)).dailyLimit, 30);
});

test("숫자: 소수·참거짓·배열·지수 표기는 조용히 바꾸지 않고 오류다", () => {
    for (const bad of [2.9, true, false, [7], "2.0", "1e3", "7개", NaN, Infinity, {}]) {
        assert.equal(
            errorOf(validateLimitSettings({ dailyLimit: bad }, settings(), TODAY)),
            "하루 최대 발송 수는 1~100000 사이 정수여야 합니다.",
            `값: ${String(bad)}`,
        );
    }
});

test("숫자 범위와 조사가 맞는 오류 문구", () => {
    const cur = settings();
    assert.equal(
        errorOf(validateLimitSettings({ dailyLimit: 0 }, cur, TODAY)),
        "하루 최대 발송 수는 1~100000 사이 정수여야 합니다.",
    );
    assert.equal(errorOf(validateLimitSettings({ dailyLimit: 100001 }, cur, TODAY)), "하루 최대 발송 수는 1~100000 사이 정수여야 합니다.");
    assert.equal(okValue(validateLimitSettings({ dailyLimit: 100000 }, cur, TODAY)).dailyLimit, 100000);
    assert.equal(
        errorOf(validateLimitSettings({ sendWindowStart: 24, sendWindowEnd: 24 }, cur, TODAY)),
        "발송 시작 시각은 0~23 사이 정수여야 합니다.",
    );
    assert.equal(
        errorOf(validateLimitSettings({ sendWindowStart: 0, sendWindowEnd: 0 }, cur, TODAY)),
        "발송 종료 시각은 1~24 사이 정수여야 합니다.",
    );
    assert.equal(
        errorOf(validateLimitSettings({ warmupStartCount: 0 }, cur, TODAY)),
        "웜업 첫날 발송 수는 1~100000 사이 정수여야 합니다.",
    );
    assert.equal(errorOf(validateLimitSettings({ warmupStep: -1 }, cur, TODAY)), "웜업 하루 증가 수는 0~100000 사이 정수여야 합니다.");
    assert.equal(okValue(validateLimitSettings({ warmupStep: 0 }, cur, TODAY)).warmupStep, 0);
    const w = okValue(validateLimitSettings({ sendWindowStart: 0, sendWindowEnd: 24 }, cur, TODAY));
    assert.deepEqual([w.sendWindowStart, w.sendWindowEnd], [0, 24]);
});

test("시간대: 합친 값으로 본다 — 시작만 바꿔 끝보다 늦어지면 오류 (W10)", () => {
    const cur = settings(WINDOW_9_18);
    assert.equal(
        errorOf(validateLimitSettings({ sendWindowStart: 19 }, cur, TODAY)),
        "발송 종료 시각은 시작 시각보다 늦어야 합니다.",
    );
    assert.equal(errorOf(validateLimitSettings({ sendWindowEnd: 9 }, cur, TODAY)), "발송 종료 시각은 시작 시각보다 늦어야 합니다.");
    const v = okValue(validateLimitSettings({ sendWindowStart: 10 }, cur, TODAY));
    assert.deepEqual([v.sendWindowStart, v.sendWindowEnd], [10, 18]);
});

test("시간대: 시작과 끝은 함께 정하고 함께 비운다", () => {
    const msg = "발송 시간대는 시작 시각과 종료 시각을 함께 정해야 합니다.";
    assert.equal(errorOf(validateLimitSettings({ sendWindowStart: 9 }, settings(), TODAY)), msg);
    assert.equal(errorOf(validateLimitSettings({ sendWindowEnd: null }, settings(WINDOW_9_18), TODAY)), msg);
    const cleared = okValue(validateLimitSettings({ sendWindowStart: null, sendWindowEnd: "" }, settings(WINDOW_9_18), TODAY));
    assert.deepEqual([cleared.sendWindowStart, cleared.sendWindowEnd], [null, null]);
});

test("웜업은 하루 최대가 필요하다 — 저장된 하루 최대도 본다 (W10)", () => {
    const msg = "웜업을 켜려면 웜업이 멈출 하루 최대 발송 수를 정해야 합니다.";
    assert.equal(errorOf(validateLimitSettings({ warmupEnabled: true }, settings(), TODAY)), msg);
    assert.equal(okValue(validateLimitSettings({ warmupEnabled: "true" }, settings({ dailyLimit: 50 }), TODAY)).warmupEnabled, true);
    assert.equal(okValue(validateLimitSettings({ warmupEnabled: true, dailyLimit: "80" }, settings(), TODAY)).dailyLimit, 80);
    // 웜업 중인 주소에서 하루 최대만 비우면 끝없이 오르게 된다
    const warming = settings({ warmupEnabled: true, dailyLimit: 50, warmupStartedOn: "2026-09-28" });
    assert.equal(errorOf(validateLimitSettings({ dailyLimit: null }, warming, TODAY)), msg);
});

test("고르게 나누기는 시간대와 한도가 필요하다 (W10)", () => {
    assert.equal(
        errorOf(validateLimitSettings({ spreadEvenly: true, dailyLimit: 50 }, settings(), TODAY)),
        "고르게 나눠 보내려면 발송 시간대를 정해야 합니다.",
    );
    assert.equal(
        errorOf(validateLimitSettings({ spreadEvenly: true, ...WINDOW_9_18 }, settings(), TODAY)),
        "고르게 나눠 보내려면 하루 최대 발송 수나 웜업을 정해야 합니다.",
    );
    assert.equal(
        okValue(validateLimitSettings({ spreadEvenly: true }, settings({ dailyLimit: 54, ...WINDOW_9_18 }), TODAY)).spreadEvenly,
        true,
    );
    // 고르게가 켜진 주소에서 시간대만 비우면 오류
    assert.equal(
        errorOf(validateLimitSettings({ sendWindowStart: null, sendWindowEnd: null }, SPREAD_54, TODAY)),
        "고르게 나눠 보내려면 발송 시간대를 정해야 합니다.",
    );
});

test("다른 칸은 무시하고, 현재 값은 고치지 않는다", () => {
    const cur = settings({ dailyLimit: 30 });
    const snapshot = { ...cur };
    const v = okValue(validateLimitSettings({ name: "영업팀", fromEmail: "a@b.c", dailyLimit: 10 }, cur, TODAY));
    assert.equal(v.dailyLimit, 10);
    assert.deepEqual(cur, snapshot);
    assert.equal("name" in v, false);
});

test("patch의 warmupStartedOn은 무시한다 — 서버가 정한다", () => {
    assert.equal(
        okValue(validateLimitSettings({ warmupStartedOn: "2020-01-01", dailyLimit: 10 }, settings(), TODAY)).warmupStartedOn,
        null,
    );
    const warming = settings({ warmupEnabled: true, dailyLimit: 50, warmupStartedOn: "2026-09-28" });
    assert.equal(
        okValue(validateLimitSettings({ warmupStartedOn: "2020-01-01" }, warming, TODAY)).warmupStartedOn,
        "2026-09-28",
    );
});

// ── W11: 웜업 시작일 ──

test("웜업 꺼짐 → 켜짐이면 시작일 = 오늘(KST), 00:30 KST에도 그날 (W11)", () => {
    // UTC 2026-10-01T15:30 = KST 10/2 00:30. toISOString()을 쓰면 10/1이 된다
    const now = new Date("2026-10-01T15:30:00Z");
    const today = kstParts(now).date;
    assert.equal(today, "2026-10-02");
    assert.notEqual(now.toISOString().slice(0, 10), today);
    const v = okValue(validateLimitSettings({ warmupEnabled: true, dailyLimit: 50 }, settings(), today));
    assert.equal(v.warmupStartedOn, "2026-10-02");
    assert.equal(capForDate(v, today), DEFAULT_WARMUP_START);
});

test("웜업이 켜진 채 다른 칸을 바꾸면 시작일을 그대로 둔다", () => {
    const warming = settings({ warmupEnabled: true, dailyLimit: 50, warmupStartedOn: "2026-09-28" });
    const v = okValue(validateLimitSettings({ warmupStep: 7, warmupEnabled: true }, warming, TODAY));
    assert.equal(v.warmupStartedOn, "2026-09-28");
    assert.equal(v.warmupStep, 7);
});

test("웜업을 끄면 시작일을 비운다", () => {
    const warming = settings({ warmupEnabled: true, dailyLimit: 50, warmupStartedOn: "2026-09-28" });
    assert.equal(okValue(validateLimitSettings({ warmupEnabled: "false" }, warming, TODAY)).warmupStartedOn, null);
});

test("켜져 있는데 시작일이 비어 있으면(옛 값) 오늘부터 센다", () => {
    const legacy = settings({ warmupEnabled: true, dailyLimit: 50, warmupStartedOn: null });
    assert.equal(okValue(validateLimitSettings({}, legacy, TODAY)).warmupStartedOn, TODAY);
});

// ── 저장된 값 읽기 (toLimitSettings) ──

test("toLimitSettings는 DB 행을 그대로 읽는다", () => {
    const s = toLimitSettings({
        dailyLimit: 50,
        warmupEnabled: true,
        warmupStartCount: 10,
        warmupStep: 5,
        warmupStartedOn: "2026-10-01",
        sendWindowStart: 9,
        sendWindowEnd: 18,
        weekdaysOnly: true,
        spreadEvenly: true,
        isPaused: false,
    });
    assert.deepEqual(s, {
        dailyLimit: 50,
        warmupEnabled: true,
        warmupStartCount: 10,
        warmupStep: 5,
        warmupStartedOn: "2026-10-01",
        sendWindowStart: 9,
        sendWindowEnd: 18,
        weekdaysOnly: true,
        spreadEvenly: true,
        isPaused: false,
    });
});

test("toLimitSettings는 참거짓·숫자를 엄격하게 읽는다", () => {
    const s = toLimitSettings({ isPaused: "false", weekdaysOnly: "yes", dailyLimit: "50", warmupStep: 2.5 });
    assert.equal(s.isPaused, false);
    assert.equal(s.weekdaysOnly, false);
    assert.equal(s.dailyLimit, 50);
    assert.equal(s.warmupStep, null);
    assert.equal(toLimitSettings({ warmupStartedOn: "2026-02-30" }).warmupStartedOn, null);
    assert.equal(toLimitSettings({ warmupStartedOn: new Date("2026-10-01T00:00:00Z") }).warmupStartedOn, "2026-10-01");
});

test("어긋난 시간대는 풀지 않고 좁게 읽는다 — 밤에 나가지 않게", () => {
    const pick = (start: unknown, end: unknown) => {
        const s = toLimitSettings({ sendWindowStart: start, sendWindowEnd: end });
        return [s.sendWindowStart, s.sendWindowEnd];
    };
    assert.deepEqual(pick(9, null), [9, 24]);
    assert.deepEqual(pick(null, 18), [0, 18]);
    assert.deepEqual(pick(18, 9), [18, 24]);
    assert.deepEqual(pick(null, null), [null, null]);
    assert.deepEqual(pick(-3, 30), [0, 24]);
});

test("toLimitSettings를 거치지 않은 어긋난 시간대도 열지 않는다", () => {
    const s = settings({ sendWindowStart: 9, sendWindowEnd: 5 });
    assert.equal(hasAnyLimit(s), true);
    assert.equal(isSendableNow(s, at("2026-10-01T03:00")), false);
    assert.equal(isSendableNow(s, at("2026-10-01T10:00")), true);
});

// ── 미룸 문구 ──

test("describeDeferral은 KST 짧은 시각으로 적는다", () => {
    assert.equal(describeDeferral("daily_limit", kstToDate("2026-10-03", 9)), "deferred(daily_limit) until 10/3 09:00");
    assert.equal(describeDeferral("spacing", at("2026-10-01T10:10")), "deferred(spacing) until 10/1 10:10");
});

// ── 발신 주소 묶음 ──

test("linkSenderPool: 묶음이 있으면 묶음, 없으면 옛 칸 하나, 둘 다 없으면 빈 목록", () => {
    assert.deepEqual(linkSenderPool({ senderProfileId: 3, senderProfileIds: [5, 3, 9] }), [5, 3, 9]);
    assert.deepEqual(linkSenderPool({ senderProfileId: 3, senderProfileIds: [] }), [3]);
    assert.deepEqual(linkSenderPool({ senderProfileId: 3, senderProfileIds: null }), [3]);
    assert.deepEqual(linkSenderPool({ senderProfileId: null, senderProfileIds: null }), []);
});

test("linkSenderPool: jsonb에 섞인 이상한 값과 중복은 걸러 낸다", () => {
    const dirty = [5, "7", null, 0, -1, 2.5, 5, 9] as unknown as number[];
    assert.deepEqual(linkSenderPool({ senderProfileId: 1, senderProfileIds: dirty }), [5, 9]);
    assert.deepEqual(linkSenderPool({ senderProfileId: 1, senderProfileIds: ["x"] as unknown as number[] }), [1]);
});

test("normalizeSenderPool: 중복 제거·순서 유지, 빈 배열과 null은 ids:null", () => {
    assert.deepEqual(normalizeSenderPool([3, 1, 3, 2]), { ok: true, ids: [3, 1, 2] });
    assert.deepEqual(normalizeSenderPool([]), { ok: true, ids: null });
    assert.deepEqual(normalizeSenderPool(null), { ok: true, ids: null });
});

test("normalizeSenderPool: 배열이 아니거나 양의 정수가 아니면 오류", () => {
    for (const bad of [undefined, "1,2", 3, { 0: 1 }]) {
        const r = normalizeSenderPool(bad);
        assert.equal(r.ok, false, `값: ${String(bad)}`);
    }
    for (const bad of [[0], [-1], [1.5], ["2"], [null], [true], [Number.MAX_SAFE_INTEGER]]) {
        assert.deepEqual(normalizeSenderPool(bad), { ok: false, error: "발신 주소 id는 양의 정수여야 합니다." });
    }
});

test("normalizeSenderPool: 중복을 뺀 뒤 50개까지", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i + 1);
    assert.deepEqual(normalizeSenderPool([...fifty, 1, 2]), { ok: true, ids: fifty });
    assert.deepEqual(normalizeSenderPool([...fifty, 51]), {
        ok: false,
        error: "발신 주소는 최대 50개까지 묶을 수 있습니다.",
    });
});

test("normalizeSenderPool: 큰 배열은 중복을 거르기 전에 길이로 바로 거절한다", () => {
    // 서로 다른 값 10만 개 — 예전 O(n²) 중복 제거로는 몇 초 동안 이벤트 루프가 멈췄다
    const huge = Array.from({ length: 100_000 }, (_, i) => i + 1);
    const startedAt = Date.now();
    assert.deepEqual(normalizeSenderPool(huge), {
        ok: false,
        error: `발신 주소는 최대 ${MAX_SENDER_POOL_SIZE}개까지 묶을 수 있습니다.`,
    });
    assert.ok(Date.now() - startedAt < 200, "길이 확인은 배열을 훑지 않아야 한다");
    // 정수가 아닌 값이 섞인 큰 배열도 길이에서 먼저 막힌다
    assert.equal(normalizeSenderPool([...huge, "x"]).ok, false);
});

test("normalizeSenderPool: 상한 안이면 중복이 많이 섞여도 받아 준다", () => {
    const repeated = Array.from({ length: MAX_SENDER_POOL_INPUT }, (_, i) => (i % 3) + 1);
    assert.deepEqual(normalizeSenderPool(repeated), { ok: true, ids: [1, 2, 3] });
    assert.equal(normalizeSenderPool([...repeated, 1]).ok, false);
});

test("linkSenderPool: 저장된 큰 묶음도 순서를 지키며 한 번에 거른다", () => {
    // 중복 제거를 Set으로 바꿔도 처음 나온 순서가 유지돼야 한다
    const ids = [9, 3, 9, 1, 3, 7];
    assert.deepEqual(linkSenderPool({ senderProfileId: null, senderProfileIds: ids }), [9, 3, 1, 7]);
});
