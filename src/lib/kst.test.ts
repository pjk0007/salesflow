import { test } from "node:test";
import assert from "node:assert";
import {
    addDaysYmd,
    formatKstHm,
    formatKstShort,
    isBusinessHours,
    kstParts,
    kstToDate,
    nextBusinessStart,
    nextWeekdayYmd,
    weekdayOfYmd,
} from "./kst";

// 2026-10-01은 목요일, 10-02 금요일, 10-03 토요일, 10-05 월요일이다

// ── kstParts·kstToDate ──

test("UTC 15:30은 한국 다음 날 00:30이다", () => {
    assert.deepEqual(kstParts(new Date("2026-10-01T15:30:00Z")), {
        date: "2026-10-02",
        hour: 0,
        minute: 30,
        weekday: 5,
    });
});

test("kstToDate는 한국 시각을 UTC 순간으로 바꾼다", () => {
    assert.equal(kstToDate("2026-10-05", 9).toISOString(), "2026-10-05T00:00:00.000Z");
    assert.equal(kstToDate("2026-10-05", 18, 30).toISOString(), "2026-10-05T09:30:00.000Z");
    // 한국 자정은 UTC 전날 15:00
    assert.equal(kstToDate("2026-11-01", 0).toISOString(), "2026-10-31T15:00:00.000Z");
});

// ── addDaysYmd·요일 ──

test("addDaysYmd는 달·해를 넘긴다", () => {
    assert.equal(addDaysYmd("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysYmd("2028-02-28", 1), "2028-02-29");
});

test("요일과 다음 평일", () => {
    assert.equal(weekdayOfYmd("2026-10-01"), 4);
    assert.equal(nextWeekdayYmd("2026-10-01"), "2026-10-02");
    assert.equal(nextWeekdayYmd("2026-10-02"), "2026-10-05");
    assert.equal(nextWeekdayYmd("2026-10-03"), "2026-10-05");
    assert.equal(nextWeekdayYmd("2026-10-04"), "2026-10-05");
});

// ── formatKstShort ──

test("formatKstShort는 월·일 앞 0 없이, 시·분은 두 자리로 쓴다", () => {
    assert.equal(formatKstShort(new Date("2026-01-05T00:07:00Z")), "1/5 09:07");
    assert.equal(formatKstShort(new Date("2026-10-02T05:20:00+09:00")), "10/2 05:20");
    assert.equal(formatKstHm(new Date("2026-10-02T05:20:00+09:00")), "05:20");
});

test("formatKstShort는 UTC 연말 밤을 한국 새해로 쓴다", () => {
    assert.equal(formatKstShort(new Date("2026-12-31T15:00:00Z")), "1/1 00:00");
});

// ── isBusinessHours ──

test("금요일 17:59는 근무시간, 18:00은 아니다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-02T17:59:00+09:00")), true);
    assert.equal(isBusinessHours(new Date("2026-10-02T18:00:00+09:00")), false);
});

test("월요일 08:59는 근무시간이 아니고 09:00부터다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-05T08:59:00+09:00")), false);
    assert.equal(isBusinessHours(new Date("2026-10-05T09:00:00+09:00")), true);
});

test("토요일 낮은 근무시간이 아니다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-03T11:00:00+09:00")), false);
});

test("UTC로는 금요일이어도 한국이 토요일이면 근무시간이 아니다", () => {
    // 2026-10-02T15:30Z = 한국 10/3(토) 00:30
    assert.equal(isBusinessHours(new Date("2026-10-02T15:30:00Z")), false);
});

// ── nextBusinessStart ──

test("근무시간 안이면 그 순간 그대로", () => {
    const now = new Date("2026-10-01T14:20:00+09:00");
    assert.equal(nextBusinessStart(now).getTime(), now.getTime());
});

test("일요일 밤은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-04T23:30:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("금요일 18:00은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-02T18:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("평일 09:00 전이면 그날 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-05T08:59:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("목요일 밤은 금요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-01T21:00:00+09:00")).toISOString(),
        new Date("2026-10-02T09:00:00+09:00").toISOString()
    );
});

test("토요일은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-03T10:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});
