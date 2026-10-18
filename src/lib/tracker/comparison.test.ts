import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparisonKpi, resolveComparisonPeriod } from "./comparison";
import { comparisonFromSearchParams, comparisonSearchParams } from "@/components/tracker/utils/comparison";
import type { AggregateRangeResult } from "./analytics-queries";

const now = new Date("2026-10-18T05:00:00Z");
const range = { from: "2026-10-05", to: "2026-10-11", preset: "7d" as const };
const current: AggregateRangeResult = { visitors: 140, sessions: 280, pageviews: 420, avgDwell: 120, bounces: 140, leads: 28, signups: 14 };
const previous: AggregateRangeResult = { visitors: 140, sessions: 140, pageviews: 280, avgDwell: 60, bounces: 35, leads: 14, signups: 7 };

test("기본 비교는 바로 앞의 같은 길이 날짜이며 양 끝 날짜를 포함한다", () => {
    assert.deepEqual(resolveComparisonPeriod(range, null, null, now), {
        from: "2026-09-28", to: "2026-10-04", mode: "previous", currentDays: 7, days: 7, countBasis: "total",
    });
    const leap = resolveComparisonPeriod({ from: "2024-03-01", to: "2024-03-01" }, null, null, now);
    assert.equal(leap.from, "2024-02-29");
});

test("기간 길이가 다르면 양쪽 건수를 일평균으로 보정한다", () => {
    const period = resolveComparisonPeriod(range, "2026-09-01", "2026-09-14", now);
    const kpi = buildComparisonKpi(current, previous, period);
    assert.equal(period.countBasis, "dailyAverage");
    assert.equal(kpi.visitors.value, 140);
    assert.deepEqual(kpi.visitors.dailyAverage, { current: 20, comparison: 10 });
    assert.equal(kpi.visitors.deltaPct, 100);
    assert.deepEqual(kpi.sessions.dailyAverage, { current: 40, comparison: 10 });
    assert.equal(kpi.sessions.deltaPct, 300);
    assert.equal(kpi.pageviews.deltaPct, 200);
});

test("체류 평균과 비율은 기간 일수로 다시 나누지 않는다", () => {
    const period = resolveComparisonPeriod(range, "2026-09-01", "2026-09-14", now);
    const kpi = buildComparisonKpi(current, previous, period);
    assert.deepEqual(kpi.avgDwellSec, { value: 120, comparisonValue: 60, deltaPct: 100 });
    assert.deepEqual(kpi.bounceRate, { value: 0.5, comparisonValue: 0.25, deltaPct: 100 });
    assert.deepEqual(kpi.leadRate, { value: 0.2, comparisonValue: 0.1, deltaPct: 100 });
    assert.deepEqual(kpi.signupRate, { value: 0.1, comparisonValue: 0.05, deltaPct: 100 });
});

test("같은 길이는 합계 대비 증감률을 유지한다", () => {
    const kpi = buildComparisonKpi(current, previous, resolveComparisonPeriod(range, null, null, now));
    assert.equal(kpi.visitors.deltaPct, 0);
    assert.equal(kpi.sessions.deltaPct, 100);
    assert.equal(kpi.pageviews.deltaPct, 50);
    assert.equal(kpi.visitors.dailyAverage, undefined);
});

test("비교 값 0은 계산 불가, 현재 값 0은 -100%, 반올림된 -0은 0으로 표시한다", () => {
    const period = resolveComparisonPeriod(range, null, null, now);
    const empty = { visitors: 0, sessions: 0, pageviews: 0, bounces: 0, avgDwell: 0, leads: 0, signups: 0 };
    const noBaseline = buildComparisonKpi(current, empty, period);
    for (const metric of Object.values(noBaseline)) assert.equal(metric.deltaPct, null);
    assert.equal(buildComparisonKpi(empty, current, period).bounceRate.deltaPct, -100);
    assert.equal(Object.is(buildComparisonKpi({ ...current, visitors: 999999 }, { ...previous, visitors: 1000000 }, period).visitors.deltaPct, -0), false);
});

test("불완전·잘못된 날짜·역순·미래 비교는 집계 전에 거절하고 KST 오늘은 허용한다", () => {
    for (const [from, to] of [["2026-09-01", null], [null, "2026-09-14"], ["", ""], ["2026-02-30", "2026-03-01"], ["2026-10-02", "2026-10-01"], ["2026-10-18", "2026-10-19"]]) {
        assert.throws(() => resolveComparisonPeriod(range, from, to, now));
    }
    assert.throws(() => resolveComparisonPeriod({ from: "2026-02-30", to: "2026-03-01" }, null, null, now));
    assert.throws(() => resolveComparisonPeriod({ from: "2026-10-11", to: "2026-10-05" }, null, null, now));
    assert.equal(resolveComparisonPeriod(range, "2026-10-18", "2026-10-18", new Date("2026-10-17T15:01:00Z")).days, 1);
});

test("직접 고른 비교 날짜는 URL·다른 탭에서 복구되고 기본값 복귀는 비교만 제거한다", () => {
    const selection = { from: "2026-09-01", to: "2026-09-14" };
    const query = comparisonSearchParams(selection, new URLSearchParams("preset=7d&from=2026-10-05&to=2026-10-11&tab=marketing&siteId=8"));
    assert.deepEqual(comparisonFromSearchParams(query, range, now), selection);
    const reset = comparisonSearchParams(null, query);
    assert.equal(reset.has("compareFrom"), false);
    assert.equal(reset.has("compareTo"), false);
    assert.equal(reset.get("tab"), "marketing");
    assert.equal(reset.get("from"), "2026-10-05");
    assert.equal(comparisonFromSearchParams(new URLSearchParams("compareFrom=invalid"), range, now), null);
});
