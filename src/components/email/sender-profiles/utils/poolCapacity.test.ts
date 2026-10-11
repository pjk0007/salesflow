import { test } from "node:test";
import assert from "node:assert";
import { DEFAULT_LIMIT_SETTINGS, type SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import { kstToDate } from "@/lib/kst";
import {
    inboundReserveNote,
    memberRemainingLabel,
    memberToday,
    poolCapacity,
    poolCapacityLine,
    poolCapacityShort,
} from "./poolCapacity";

// 2026-10-02 금요일, 10-03 토요일
const FRI_10 = kstToDate("2026-10-02", 10);
const CAP4: SenderLimitSettings = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 4 };
const NONE: SenderLimitSettings = DEFAULT_LIMIT_SETTINGS;
const WINDOWED: SenderLimitSettings = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 18 };

const used = (sentToday: number, cap: number | null, usageDate = "2026-10-02") => ({ usageDate, sentToday, cap });

// Q7 — 규칙 화면의 묶음 합계 줄: 한도 4·4·없음 묶음 (DESIGN-2 Q1과 같은 묶음)
test("한도 4·4·없음 묶음: 오늘 최대 8통 · 남은 수 · 한도 없는 주소 1개", () => {
    const members = [
        memberToday(CAP4, used(1, 4), FRI_10),
        memberToday(CAP4, used(2, 4), FRI_10),
        memberToday(NONE, used(5, null), FRI_10),
    ];
    const p = poolCapacity(members);
    assert.deepEqual(p, {
        size: 3,
        todayMax: 8,
        todayRemaining: 5,
        unlimited: 1,
        inboundReserve: 2,
        reserveReleaseHours: [15],
    });
    assert.equal(poolCapacityLine(p), "오늘 이 묶음으로 최대 8통 · 남은 5통 · 한도 없는 주소 1개(제한 없이 돌아가며 보냄)");
    assert.equal(poolCapacityShort(p), "주소 3개 · 최대 8통 · 남은 5통 · 한도 없음 1개");
    assert.deepEqual(members.map(memberRemainingLabel), ["남은 3통", "남은 2통", "한도 없음"]);
});

test("문의 몫 합계: 주소마다 한도의 10% 올림(서버 inboundReserve), 한도 1 이하·제한 없음은 0", () => {
    const caps = [10, 25, 30, 2, 1, 0, null];
    const p = poolCapacity(caps.map((cap) => ({ cap, sent: 0, remaining: cap })));
    // 1 + 3 + 3 + 1 + 0 + 0 + 0 (30 × 0.1을 올려 4로 세지 않는다)
    assert.equal(p.inboundReserve, 8);
});

test("문의 몫 안내는 남겨 둘 몫이 있을 때만, 15:00 전에는 오늘 합계를 적는다", () => {
    const p = poolCapacity([memberToday(CAP4, used(0, 4), FRI_10), memberToday(WINDOWED, used(0, 10), FRI_10)]);
    const note = inboundReserveNote(p, FRI_10) ?? "";
    assert.match(note, /15:00까지 주소마다 하루 한도의 10%\(오늘 합계 2통\)/);
    assert.match(note, /대량 명단은 15:00부터 이 몫도 씁니다/);
    const ones = poolCapacity([memberToday({ ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 1 }, used(0, 1), FRI_10)]);
    assert.equal(inboundReserveNote(ones, FRI_10), null);
});

test("15:00이 지나면 문의 몫이 풀렸다고 적는다 (오늘 합계를 남겨 둔 것처럼 보이지 않게)", () => {
    const p = poolCapacity([memberToday(CAP4, used(0, 4), FRI_10)]);
    const note = inboundReserveNote(p, kstToDate("2026-10-02", 15)) ?? "";
    assert.match(note, /^15:00이 지나 문의·수동 메일 몫\(주소마다 하루 한도의 10%\)도 대량 명단이 씁니다/);
    assert.doesNotMatch(note, /오늘 합계/);
    assert.match(inboundReserveNote(p, kstToDate("2026-10-02", 14, 59)) ?? "", /오늘 합계 1통/);
});

test("한도 없는 주소만: 제한 없이 돌아가며 보낸다는 한 줄, 문의 몫 없음", () => {
    const p = poolCapacity([memberToday(NONE, used(3, null), FRI_10), memberToday(NONE, undefined, FRI_10)]);
    assert.equal(p.todayMax, null);
    assert.equal(poolCapacityLine(p), "오늘 이 묶음은 한도 없음 · 주소 2개를 제한 없이 돌아가며 보냄");
    assert.equal(poolCapacityShort(p), "주소 2개 · 한도 없음");
    assert.equal(inboundReserveNote(p, FRI_10), null);
});

test("빈 묶음(기본 프로필도 없음)은 합계 줄을 보이지 않는다", () => {
    const p = poolCapacity([]);
    assert.equal(poolCapacityLine(p), null);
    assert.equal(poolCapacityShort(p), "—");
});

test("사용량을 못 읽으면 남은 수를 지어내지 않는다 — 최대만 보인다", () => {
    const t = memberToday(CAP4, undefined, FRI_10);
    assert.deepEqual(t, { cap: 4, sent: null, remaining: null, releaseHour: 15 });
    assert.equal(memberRemainingLabel(t), null);
    const p = poolCapacity([t, memberToday(CAP4, used(1, 4), FRI_10)]);
    assert.equal(poolCapacityLine(p), "오늘 이 묶음으로 최대 8통");
});

test("어제 사용량은 쓰지 않는다 (날이 바뀐 직후)", () => {
    const t = memberToday(CAP4, used(4, 4, "2026-10-01"), FRI_10);
    assert.deepEqual(t, { cap: 4, sent: null, remaining: null, releaseHour: 15 });
});

test("시간대가 끝난 오늘은 한도가 남아도 남은 0통, 시간대 전이면 그대로 센다", () => {
    assert.equal(memberToday(WINDOWED, used(3, 10), kstToDate("2026-10-02", 19)).remaining, 0);
    assert.equal(memberToday(WINDOWED, used(0, 10), kstToDate("2026-10-02", 8)).remaining, 10);
    assert.equal(memberToday(WINDOWED, used(3, 10), FRI_10).remaining, 7);
});

test("정지한 주소는 오늘 0통, 다 쓴 주소는 남은 0통 (음수 아님)", () => {
    const paused = memberToday({ ...CAP4, isPaused: true }, undefined, FRI_10);
    assert.equal(paused.cap, 0);
    assert.equal(memberRemainingLabel(memberToday({ ...CAP4, isPaused: true }, used(0, 0), FRI_10)), "남은 0통");
    assert.equal(memberToday(CAP4, used(6, 4), FRI_10).remaining, 0);
});

test("평일만 주소의 주말은 한도 0 — 묶음 최대에 더하지 않는다", () => {
    const sat = kstToDate("2026-10-03", 10);
    const weekdays: SenderLimitSettings = { ...CAP4, weekdaysOnly: true };
    const p = poolCapacity([memberToday(weekdays, undefined, sat), memberToday(CAP4, used(0, 4, "2026-10-03"), sat)]);
    assert.equal(p.todayMax, 4);
    assert.equal(p.todayRemaining, null);
});

// REVIEW-2 정책 F4 — 발송 시간대가 15시 전에 끝나는 주소는 몫을 시간대 마지막 한 시간에 푼다 (서버 reserveReleaseHour와 같은 값)
test("시간대가 15시 전에 끝나는 주소: 몫이 풀리는 시각을 안내에 덧붙이고, 다 풀리면 풀렸다고 적는다", () => {
    const early: SenderLimitSettings = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 13 };
    const t = memberToday(early, used(0, 10), FRI_10);
    assert.equal(t.releaseHour, 12);
    const mixed = poolCapacity([t, memberToday(CAP4, used(0, 4), FRI_10)]);
    assert.deepEqual(mixed.reserveReleaseHours, [12, 15]);
    const note = inboundReserveNote(mixed, FRI_10) ?? "";
    assert.match(note, /15:00까지 주소마다 하루 한도의 10%\(오늘 합계 2통\)/);
    assert.match(note, /발송 시간대가 15시 전에 끝나는 주소는 시간대 마지막 한 시간\(12:00\)부터 씁니다/);

    // 시간대가 이른 주소만 있으면 그 시각이 기준이다
    const only = poolCapacity([t]);
    assert.match(inboundReserveNote(only, FRI_10) ?? "", /12:00까지 주소마다/);
    assert.match(inboundReserveNote(only, kstToDate("2026-10-02", 12)) ?? "", /^12:00이 지나 문의·수동 메일 몫/);
});
