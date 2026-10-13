import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMIT_SETTINGS } from "./email-sender-limit-rules";
import { kstParts, kstToDate } from "./kst";
import { DELIVERY_GRACE_MS, isDeliveryDue, nextPreparationAt, nextRandomDailySlot, preparedMinimumGapMs, preparedSourceHash, randomDailySlots } from "./email-random-schedule-rules";

const settings = { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 18 };
const times = (id = 1, day = "2026-10-12") => randomDailySlots(id, settings, day).map((d) => d.getTime());

test("할당량만큼 서로 다른 시각에 나누며 시간대와 문의 예약 몫을 지킨다", () => {
    const slots = times();
    assert.equal(slots.length, 10);
    assert.equal(new Set(slots).size, 10);
    assert.ok(slots[0] > kstToDate("2026-10-12", 9).getTime());
    assert.ok(slots.at(-1)! < kstToDate("2026-10-12", 18).getTime());
    assert.ok(slots.at(-1)! > kstToDate("2026-10-12", 15).getTime());
    assert.ok(slots.every((at, i) => i === 0 || at - slots[i - 1] > 20 * 60 * 1000));
});

test("재시작해도 같은 예약표이고 날짜와 주소가 달라지면 시각도 달라진다", () => {
    assert.deepEqual(times(), times());
    assert.notDeepEqual(times(1), times(2));
    assert.notDeepEqual(times(1).map((n) => n % 86400000), times(1, "2026-10-13").map((n) => n % 86400000));
});

test("시간대가 없으면 한국 시간 09~18시로 배정한다", () => {
    const slots = randomDailySlots(1, { ...DEFAULT_LIMIT_SETTINGS, dailyLimit: 10 }, "2026-10-12");
    assert.ok(slots.every((d) => kstParts(d).hour >= 9 && kstParts(d).hour < 18));
});

test("웜업 한도를 따르고 정지·평일만 설정·한도 없는 주소를 임의로 예약하지 않는다", () => {
    const ramp = { ...settings, dailyLimit: 100, warmupEnabled: true, warmupStartCount: 10, warmupStep: 5, warmupStartedOn: "2026-10-12" };
    assert.equal(randomDailySlots(1, ramp, "2026-10-13").length, 15);
    assert.deepEqual(randomDailySlots(1, { ...settings, isPaused: true }, "2026-10-12"), []);
    assert.deepEqual(randomDailySlots(1, { ...settings, weekdaysOnly: true }, "2026-10-17"), []);
    assert.deepEqual(randomDailySlots(1, DEFAULT_LIMIT_SETTINGS, "2026-10-12"), []);
});

test("다음 날 준비는 발송 시작 한 시간 전이며 평일만 주소는 주말을 건너뛴다", () => {
    assert.equal(nextPreparationAt({ ...settings, weekdaysOnly: true }, kstToDate("2026-10-16", 18)).toISOString(), kstToDate("2026-10-19", 8).toISOString());
});

test("예약 전에는 보내지 않으며 오래 밀린 건은 즉시 따라잡지 않는다", () => {
    const due = kstToDate("2026-10-12", 12);
    assert.equal(isDeliveryDue(due, new Date(due.getTime() - 1)), false);
    assert.equal(isDeliveryDue(due, new Date(due.getTime() + 30_000)), true);
    assert.equal(isDeliveryDue(due, new Date(due.getTime() + DELIVERY_GRACE_MS + 1)), false);
    assert.equal(preparedMinimumGapMs(settings, "2026-10-12"), 30_000);
});

test("원본 수신자·프롬프트가 바뀌면 다시 작성하되 준비 중 저장한 회사 조사는 본문을 무효화하지 않는다", () => {
    const source = { email: "test@example.invalid", company: "가상 회사" };
    assert.equal(preparedSourceHash(source, { prompt: "A" }), preparedSourceHash({ ...source, _companyResearch: { summary: "조사" } }, { prompt: "A" }));
    assert.notEqual(preparedSourceHash(source, { prompt: "A" }), preparedSourceHash(source, { prompt: "B" }));
    assert.notEqual(preparedSourceHash(source, {}), preparedSourceHash({ ...source, email: "changed@example.invalid" }, {}));
});

test("15시 전에 끝나는 시간대에서도 문의 몫이 시간대 안에서 풀린다", () => {
    for (const [start, end] of [[9, 10], [9, 12], [0, 16], [0, 24], [23, 24]]) {
        const slots = randomDailySlots(1, { ...settings, dailyLimit: 100, sendWindowStart: start, sendWindowEnd: end }, "2026-10-12");
        assert.equal(slots.length, 100);
        assert.ok(slots.every((d, i) => d < kstToDate("2026-10-12", end) && (i === 0 || d > slots[i - 1])));
    }
});

test("오후에 처음 준비해도 남은 시간대에 하루 할당량을 모두 나눈다", () => {
    const start = kstToDate("2026-10-12", 13, 2);
    const slots = randomDailySlots(1, settings, "2026-10-12", start);
    assert.equal(slots.length, 10);
    assert.ok(slots.every((d) => d > start && d < kstToDate("2026-10-12", 18)));
});

test("큰 한도에서도 다음 미래 구간을 찾고 이미 배정한 자리는 건너뛴다", () => {
    const start = kstToDate("2026-10-12", 9);
    const earliest = kstToDate("2026-10-12", 13);
    const large = { ...settings, dailyLimit: 100000 };
    const first = nextRandomDailySlot(1, large, "2026-10-12", start, earliest, new Set());
    assert.ok(first && first.scheduledAt >= earliest);
    const next = nextRandomDailySlot(1, large, "2026-10-12", start, earliest, new Set([first.ordinal]));
    assert.equal(next?.ordinal, first.ordinal + 1);
    assert.equal(nextRandomDailySlot(1, settings, "2026-10-12", start, kstToDate("2026-10-12", 18), new Set()), null);
});
