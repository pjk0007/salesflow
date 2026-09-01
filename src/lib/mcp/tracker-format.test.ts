import { test } from "node:test";
import assert from "node:assert";
import { computeFunnelMetrics, clampPageSize } from "./tracker-format";

const stages = (...counts: number[]) =>
    counts.map((visitors, i) => ({ key: `s${i + 1}`, label: `단계${i + 1}`, visitors }));

// ── computeFunnelMetrics — B3 ──

test("단계별 전환율은 직전 단계 대비다 (B3)", () => {
    const r = computeFunnelMetrics(stages(100, 50, 10));
    assert.deepEqual(r.stages.map((s) => s.conversionRate), [null, 50, 20]);
});

test("첫 단계의 전환율은 0이 아니라 null이다 (B3)", () => {
    // 0이면 Claude가 "방문 단계 전환율 0%"로 읽고 잘못 보고한다
    assert.equal(computeFunnelMetrics(stages(100, 50)).stages[0].conversionRate, null);
});

test("이탈 수는 직전 단계와의 차다 (B3)", () => {
    const r = computeFunnelMetrics(stages(100, 50, 10));
    assert.deepEqual(r.stages.map((s) => s.dropOff), [null, 50, 40]);
});

test("가장 큰 이탈 구간을 찾는다 (B3)", () => {
    const r = computeFunnelMetrics(stages(100, 90, 20));
    assert.equal(r.biggestDropOff?.toKey, "s3");
    assert.equal(r.biggestDropOff?.dropOff, 70);
});

test("이탈이 동률이면 앞선 구간을 고른다", () => {
    const r = computeFunnelMetrics(stages(100, 50, 0));
    assert.equal(r.biggestDropOff?.toKey, "s2");
});

test("전체 전환율은 마지막/첫 단계다 (B3)", () => {
    assert.equal(computeFunnelMetrics(stages(100, 50, 10)).overallConversionRate, 10);
});

test("방문자 0인 단계 뒤는 0으로 나누지 않는다", () => {
    // Infinity가 JSON에 실리면 JSON.stringify가 null로 바꿔 조용한 손실이 된다
    const r = computeFunnelMetrics(stages(100, 0, 0));
    assert.equal(r.stages[2].conversionRate, null);
});

test("첫 단계가 0이면 전체 전환율은 null이다", () => {
    assert.equal(computeFunnelMetrics(stages(0, 0)).overallConversionRate, null);
});

test("단계가 하나뿐이면 이탈 구간이 없다", () => {
    assert.equal(computeFunnelMetrics(stages(100)).biggestDropOff, null);
});

test("단계가 비면 빈 결과를 낸다", () => {
    const r = computeFunnelMetrics([]);
    assert.deepEqual(r.stages, []);
    assert.equal(r.overallConversionRate, null);
    assert.equal(r.biggestDropOff, null);
});

test("뒤 단계가 앞보다 커도 음수 이탈로 만들지 않는다", () => {
    // event 퍼널은 cumulative 역산을 하지 않아 실제로 역증가가 나온다
    const r = computeFunnelMetrics(stages(50, 80));
    assert.equal(r.stages[1].dropOff, 0);
    assert.equal(r.stages[1].conversionRate, 160);
});

test("전환율은 소수 첫째 자리로 반올림한다", () => {
    assert.equal(computeFunnelMetrics(stages(3, 1)).stages[1].conversionRate, 33.3);
});

// ── clampPageSize ──

test("미지정이면 기본값이다", () => {
    assert.equal(clampPageSize(undefined, 20, 100), 20);
});

test("최대를 넘으면 최대로 자른다", () => {
    assert.equal(clampPageSize(5000, 20, 100), 100);
});

test("0 이하는 기본값으로 되돌린다", () => {
    assert.equal(clampPageSize(0, 20, 100), 20);
    assert.equal(clampPageSize(-5, 20, 100), 20);
});

test("소수는 내림한다", () => {
    assert.equal(clampPageSize(20.9, 20, 100), 20);
});

test("숫자가 아니면 기본값이다", () => {
    assert.equal(clampPageSize("많이" as unknown as number, 20, 100), 20);
});
