import test from "node:test";
import assert from "node:assert/strict";
import { STAT_COUNT_KEYS, emptyCounts, sumCounts, deriveRates, ratePercent, deltaPct, coverageStatus, isMaturing } from "./metrics";
const NOW = new Date("2026-10-21T03:00:00Z");
test("B13: 25개 수의 빈 값과 합계는 입력을 바꾸지 않는다", () => {
    const a = emptyCounts();
    assert.equal(STAT_COUNT_KEYS.length, 25);
    assert.deepEqual(Object.values(a), Array(25).fill(0));
    const b = Object.fromEntries(STAT_COUNT_KEYS.map(key => [key, 2])) as typeof a;
    assert.deepEqual(sumCounts([a, b, b]), Object.fromEntries(STAT_COUNT_KEYS.map(key => [key, 4])));
    assert.deepEqual(sumCounts([]), a);
    assert.equal(a.sent, 0);
    assert.equal(b.sent, 2);
});
test("B13: 도달·회신·오픈·방문 분모와 백분율 반올림", () => {
    const counts = { ...emptyCounts(), delivered: 90, bounced: 5, senderSide: 3, nhnUnsub: 2, sent: 100, firstSent: 40, seqReplied: 3, replied: 2, unsubscribed: 1, visited: 4 };
    assert.deepEqual(deriveRates(counts), { deliveryRate: 90, bounceRate: 5, senderSideRate: 3, openRate: null, clickRate: 0, ctor: null, replyRate: 7.5, replyRatePerSend: 2, unsubscribeRate: 1, visitRate: 4 });
    assert.equal(ratePercent(1, 3), 33.3);
    assert.equal(ratePercent(0, 0), null);
    assert.equal(ratePercent(2, 2), 100);
    const rates = deriveRates({ ...counts, openBase: 20, opened: 10, clicked: 8, openedClicked: 3 });
    assert.equal(rates.openRate, 50);
    assert.equal(rates.clickRate, 8);
    assert.equal(rates.ctor, 30);
});
test("B12: 증감은 반올림 전 비율로 계산하고 0 분모와 null을 보존한다", () => {
    for (const [a, b, result] of [[110, 100, 10], [90, 100, -10], [5, 0, null], [0, 0, null], [null, 5, null], [5, null, null], [100, 100, 0], [1 / 3, 1 / 4, 33.3]] as const)
        assert.equal(deltaPct(a, b), result);
    assert.equal(Object.is(deltaPct(99.999, 100), -0), false);
});
test("B12: 채운 날짜가 요청 구간을 모두 덮을 때만 full", () => {
    const range = { from: "2026-09-22", to: "2026-10-21" };
    for (const [from, to, result] of [["2026-08-23", "2026-10-21", "full"], [null, "2026-10-21", "full"], ["2026-10-14", "2026-10-21", "partial"], ["2026-08-23", "2026-10-20", "partial"], ["2026-10-22", "2026-10-23", "none"]] as const)
        assert.equal(coverageStatus(range, { from, to }), result);
    assert.equal(coverageStatus(range, null), "none");
});
test("B22: 오늘 포함 최근 3일은 반응이 쌓이는 중", () => {
    assert.equal(isMaturing("2026-10-19", NOW), true);
    assert.equal(isMaturing("2026-10-18", NOW), false);
});
