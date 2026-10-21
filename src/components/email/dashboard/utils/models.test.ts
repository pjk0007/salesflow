import test from "node:test";
import assert from "node:assert/strict";
import { emptyCounts, deriveRates } from "@/lib/email-stats/metrics";
import type { KpiData, CompareRow, TrendData } from "../types";
import { periodRange, calendarRange } from "./period";
import { kpiCards } from "./kpiCards";
import { compareColumns, sortRows } from "./compare";
import { trendModel } from "./trend";
import { freshness } from "./freshness";
import { deltaColor } from "./format";

const counts = { ...emptyCounts(), accepted: 10, sent: 10 };
const data: KpiData = {
    range: { from: "2026-10-01", to: "2026-10-21", days: 21 },
    comparison: { from: "2026-09-10", to: "2026-09-30" },
    asOf: "2026-10-21T03:00:00Z", coverage: { from: null, to: "2026-10-21" },
    connections: { reply: true, site: true, journey: true },
    current: counts, previous: counts, rates: deriveRates(counts),
    currentCoverage: "full", previousCoverage: "full",
    leads: { total: 0, urgent: 0, highlight: 0, unhandled: 0, previousTotal: 0 },
    kpi: Object.fromEntries(["sent", "deliveryRate", "openRate", "clickRate", "visits", "replyRate", "keyLeads", "unsubscribeRate"].map(key => [key, { value: 10, comparison: 8, deltaPct: 25 }])) as KpiData["kpi"],
};
test("T8: 8개 KPI 순서·증감·연동·이전 기간 준비", () => {
    const cards = kpiCards(data);
    assert.deepEqual(cards.map(card => card.label), ["발송", "도달률", "사람 오픈율(추정)", "사람 클릭률", "메일 유입 방문", "회신율", "핵심 리드", "수신거부율"]);
    assert.deepEqual(cards.filter(card => card.lowerIsBetter).map(card => card.key), ["unsubscribeRate"]);
    assert.equal(cards[0].delta, "+25% · 09-10 ~ 09-30 대비");
    const disconnected = kpiCards({ ...data, connections: { reply: false, site: false, journey: false }, previousCoverage: "partial" });
    assert.deepEqual(disconnected.slice(4, 7).map(card => card.value), ["사이트 연동 안 됨", "회신 연동 안 됨", "여정 알림 연동 안 됨"]);
    assert.ok(disconnected.every(card => card.delta === "—"));
    assert.match(deltaColor(1, false), /emerald/);
    assert.match(deltaColor(1, true), /rose/);
    assert.match(deltaColor(null, false), /muted/);
});
test("T8: 비교 정렬 null은 양방향 끝, 축별 열과 회신 기준", () => {
    const rows: CompareRow[] = [null, 2, 1].map((rate, i) => ({ key: String(i), label: String(i), sublabel: null, deleted: false, counts, rates: { ...data.rates, openRate: rate } }));
    assert.deepEqual(sortRows(rows, "openRate", "asc").map(row => row.key), ["2", "1", "0"]);
    assert.deepEqual(sortRows(rows, "openRate", "desc").map(row => row.key), ["1", "2", "0"]);
    for (const axis of ["campaign", "step", "partition", "sender", "domain", "trigger", "date"] as const) {
        const columns = compareColumns(axis, data.connections);
        assert.equal(columns.some(col => col.key === "senderSideRate"), axis === "sender" || axis === "domain");
        assert.ok(columns.some(col => col.label === `회신율 (${axis === "step" || axis === "trigger" ? "통당" : "첫 메일"})`));
    }
});
test("T8: 준비 안 된 추세는 선을 끊고 최근 3일 성숙 구간을 보인다", () => {
    const input: TrendData = { ...data, points: ["18", "19", "20", "21"].map((day, i) => ({ date: `2026-10-${day}`, counts, rates: { ...data.rates, openRate: 50 }, ready: i > 0, maturing: i > 0 })) };
    const model = trendModel(input);
    assert.equal(model.points[0].openRate, null);
    assert.equal(model.points[1].openRate, 50);
    assert.deepEqual(model.bands.find(band => band.label === "반응이 쌓이는 중"), { from: "2026-10-19", to: "2026-10-21", label: "반응이 쌓이는 중" });
});
test("T8: 신선도 30분 경계와 전체 집계", () => {
    assert.equal(freshness(data, new Date("2026-10-21T03:31:00Z")).isStale, true);
    assert.equal(freshness(data, new Date("2026-10-21T03:29:00Z")).isStale, false);
    assert.equal(freshness(data, new Date(data.asOf!)).coverage, "전체 기간 집계됨");
});
test("T8: KST 오늘 포함 프리셋과 달력 날짜", () => {
    for (const [days, from] of [[7, "2026-10-15"], [30, "2026-09-22"], [90, "2026-07-24"]] as const) {
        assert.deepEqual(periodRange(days, new Date("2026-10-20T15:01:00Z")), { from, to: "2026-10-21" });
    }
    assert.deepEqual(calendarRange(new Date(2026, 9, 1), new Date(2026, 9, 21)), { from: "2026-10-01", to: "2026-10-21" });
});

test("coverage 부분 구간은 빠진 날짜를 안내한다", () => {
    const partial = { ...data, coverage: { from: "2026-10-10", to: "2026-10-21" } };
    assert.equal(freshness(partial, new Date(data.asOf!)).notice, "2026-10-10 이전 날짜는 집계 준비 중입니다. 그 날짜의 숫자는 빠져 있습니다.");
    assert.equal(freshness({ ...partial, range: { ...data.range, from: "2026-10-10" } }, new Date(data.asOf!)).notice, "");
});
