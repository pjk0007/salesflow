import { test } from "node:test";
import assert from "node:assert/strict";
import { freshness, freshnessText } from "./freshness";
import type { StatsEnvelope } from "../types";

const asOf = "2026-10-25T01:15:00Z"; // 10:15 KST

test("UX-277 홈과 이메일 통계 화면이 같은 기준 시각 문구를 쓴다", () => {
    const now = new Date("2026-10-25T01:20:00Z");
    const envelope = { range: { from: "2026-10-19", to: "2026-10-25", days: 7 }, comparison: { from: "2026-10-12", to: "2026-10-18" },
        asOf, coverage: null } as unknown as StatsEnvelope;
    assert.deepEqual(freshnessText(asOf, now), { isStale: false, text: "집계 기준 10:15" });
    assert.equal(freshness(envelope, now).text, freshnessText(asOf, now).text);
});

test("UX-277 30분 넘게 멈춘 집계·준비 중은 따로 알린다", () => {
    assert.deepEqual(freshnessText(asOf, new Date("2026-10-25T01:46:00Z")), { isStale: true, text: "집계가 멈춰 있습니다(마지막 10:15)" });
    assert.equal(freshnessText(null, new Date()).isStale, false);
    assert.match(freshnessText(null, new Date()).text, /집계 준비 중/);
});
