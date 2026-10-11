import { test } from "node:test";
import assert from "node:assert";
import { DEFAULT_LIMIT_SETTINGS, type SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import { kstToDate } from "@/lib/kst";
import { senderTodayBadges, whenLabel, type TodayUsage } from "./todayStatus";

// 2026-10-01 목요일, 10-02 금요일, 10-03 토요일, 10-05 월요일
const WARMING: SenderLimitSettings = {
    ...DEFAULT_LIMIT_SETTINGS,
    dailyLimit: 10,
    warmupEnabled: true,
    warmupStartCount: 3,
    warmupStep: 2,
    warmupStartedOn: "2026-09-29",
    sendWindowStart: 9,
    sendWindowEnd: 18,
    weekdaysOnly: true,
};

function texts(s: SenderLimitSettings, usage: TodayUsage | undefined, now: Date): string[] {
    return senderTodayBadges(s, usage, now).map((b) => b.text);
}

test("한도를 켜지 않은 주소에는 배지가 없다", () => {
    assert.deepEqual(texts(DEFAULT_LIMIT_SETTINGS, { sentToday: 3, cap: null }, kstToDate("2026-10-02", 10)), []);
});

test("주말(평일만): '오늘 0/0' 대신 쉬는 날, 월요일 웜업 날수, 다음 발송 때와 그날 한도", () => {
    const now = kstToDate("2026-10-03", 2, 55);
    // 9/29(화)~10/2(금) 4일을 보냈으니 월요일이 5일째, 그날 한도 3+2×4=11 → 하루 최대 10에서 멈춤
    assert.deepEqual(texts(WARMING, { usageDate: "2026-10-03", sentToday: 0, cap: 0 }, now), [
        "오늘 쉼(주말)",
        "웜업 5일째(월요일 재개)",
        "다음 발송 10/5(월) 09:00 · 10통",
    ]);
});

test("보낼 수 있는 시간: 웜업 날수와 오늘 사용량", () => {
    const now = kstToDate("2026-10-02", 10);
    assert.deepEqual(texts(WARMING, { usageDate: "2026-10-02", sentToday: 4, cap: 9 }, now), ["웜업 4일째", "오늘 4/9"]);
});

test("시간대 전에는 몇 시부터, 시간대 뒤에는 마감과 다음 발송 때", () => {
    const s = { ...WARMING, warmupEnabled: false };
    assert.deepEqual(texts(s, { sentToday: 0, cap: 10 }, kstToDate("2026-10-02", 7)), ["오늘 0/10 · 09:00부터"]);
    assert.deepEqual(texts(s, { sentToday: 3, cap: 10 }, kstToDate("2026-10-01", 19)), ["오늘 3/10 마감 · 내일 09:00부터"]);
    // 금요일 저녁이면 다음 발송은 월요일
    assert.deepEqual(texts(s, { sentToday: 3, cap: 10 }, kstToDate("2026-10-02", 19)), ["오늘 3/10 마감 · 10/5(월) 09:00부터"]);
});

test("오늘 한도를 다 쓰면 다 씀과 다음 날 시작 시각", () => {
    const s = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 5 };
    assert.deepEqual(texts(s, { sentToday: 5, cap: 5 }, kstToDate("2026-10-03", 11)), ["오늘 5/5 다 씀 · 내일 09:00부터"]);
});

test("정지: 정지만 보이고 오늘 숫자는 보이지 않는다", () => {
    const s = { ...WARMING, isPaused: true };
    assert.deepEqual(texts(s, { sentToday: 0, cap: 0 }, kstToDate("2026-10-03", 11)), ["정지", "웜업 5일째(정지 중)"]);
});

test("한도 없이 시간대만이면 '오늘 n통'", () => {
    const s = { ...DEFAULT_LIMIT_SETTINGS, sendWindowStart: 9, sendWindowEnd: 18 };
    assert.deepEqual(texts(s, { sentToday: 2, cap: null }, kstToDate("2026-10-02", 10)), ["오늘 2통"]);
});

test("사용량을 못 읽었거나 날짜가 지난 값이면 숫자를 지어내지 않는다", () => {
    const s = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 5, sendWindowStart: 9, sendWindowEnd: 18 };
    assert.deepEqual(texts(s, undefined, kstToDate("2026-10-02", 10)), []);
    assert.deepEqual(texts(s, undefined, kstToDate("2026-10-02", 7)), ["09:00부터 발송"]);
    assert.deepEqual(texts(s, { usageDate: "2026-10-01", sentToday: 5, cap: 5 }, kstToDate("2026-10-02", 10)), []);
});

test("서버가 오늘 한도를 0으로 본 날도 '0/0'으로 두지 않는다", () => {
    const s = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 5 };
    assert.deepEqual(texts(s, { sentToday: 0, cap: 0 }, kstToDate("2026-10-02", 10)), ["오늘 쉼 · 다음 발송 내일 09:00"]);
});

test("어떤 경우에도 'x/0'·쉬는 날의 '웜업 n일째'·지금 못 보내는데 남은 한도만 보이는 배지는 없다", () => {
    const hours = [0, 7, 9, 12, 17, 18, 23];
    const days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    const variants: SenderLimitSettings[] = [WARMING, { ...WARMING, warmupEnabled: false }, { ...WARMING, weekdaysOnly: false }];
    for (const s of variants) {
        for (const day of days) {
            for (const h of hours) {
                const now = kstToDate(day, h);
                for (const sent of [0, 3, 10]) {
                    for (const b of texts(s, { sentToday: sent, cap: 10 }, now)) {
                        assert.doesNotMatch(b, /^오늘 [\d,]+\/0$/, `${day} ${h}시 ${b}`);
                        if (/^웜업 \d+일째$/.test(b)) assert.ok(!s.weekdaysOnly || !["2026-10-03", "2026-10-04"].includes(day), `${day} ${b}`);
                        const m = b.match(/^오늘 (\d+)\/(\d+)$/);
                        if (m) {
                            const inWindow = h >= 9 && h < 18 && (!s.weekdaysOnly || !["2026-10-03", "2026-10-04"].includes(day));
                            assert.ok(Number(m[1]) < Number(m[2]) && inWindow, `${day} ${h}시 ${b}`);
                        }
                    }
                }
            }
        }
    }
});

test("다시 보내는 때 글: 오늘·내일·그 뒤", () => {
    const now = kstToDate("2026-10-02", 19);
    assert.equal(whenLabel(kstToDate("2026-10-02", 20, 5), now), "20:05");
    assert.equal(whenLabel(kstToDate("2026-10-03", 9), now), "내일 09:00");
    assert.equal(whenLabel(kstToDate("2026-10-05", 9), now), "10/5(월) 09:00");
});
