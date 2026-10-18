import { test } from "node:test";
import assert from "node:assert/strict";
import { presetRange, rangeDays, rangeFromSearchParams, rangeSearchParams, shiftRange } from "./range";
import type { Range } from "../types/overview";

const NOW = new Date(2026, 9, 18, 1, 30);

test("1일은 전날과 다음 날을 오가고 오늘에서는 다음 이동을 막는다", () => {
    const today = presetRange("1d", NOW);
    assert.deepEqual(today, { preset: "1d", from: "2026-10-18", to: "2026-10-18" });
    const yesterday = shiftRange(today, -1, NOW);
    assert.deepEqual(yesterday, { preset: "1d", from: "2026-10-17", to: "2026-10-17" });
    assert.deepEqual(shiftRange(yesterday, 1, NOW), today);
    assert.deepEqual(shiftRange(today, 1, NOW), today);
});

test("7·30·90일 이동은 이전 기간과 날짜가 겹치거나 빠지지 않고 프리셋을 유지한다", () => {
    const previousEnds = { "7d": "2026-10-11", "30d": "2026-09-18", "90d": "2026-07-20" };
    for (const preset of ["7d", "30d", "90d"] as const) {
        const current = presetRange(preset, NOW);
        const previous = shiftRange(current, -1, NOW);
        assert.equal(previous.to, previousEnds[preset]);
        assert.equal(previous.preset, preset);
        assert.equal(rangeDays(previous), rangeDays(current));
        assert.deepEqual(shiftRange(previous, 1, NOW), current);
    }
});

test("월말·연말·윤년 경계를 지나도 달력 날짜를 정확히 이동한다", () => {
    const from = (date: string): Range => ({ preset: "1d", from: date, to: date });
    assert.equal(shiftRange(from("2026-01-01"), -1, NOW).to, "2025-12-31");
    assert.equal(shiftRange(from("2024-03-01"), -1, NOW).to, "2024-02-29");
    assert.equal(shiftRange(from("2026-03-01"), -1, NOW).to, "2026-02-28");
});

test("사용자지정은 양 끝 날짜를 포함한 길이로 이동하고 미래 진입 시 오늘에 맞춘다", () => {
    const custom: Range = { preset: "custom", from: "2026-10-14", to: "2026-10-16" };
    assert.deepEqual(shiftRange(custom, -1, NOW), { preset: "custom", from: "2026-10-11", to: "2026-10-13" });
    assert.deepEqual(shiftRange(custom, 1, NOW), { preset: "custom", from: "2026-10-16", to: "2026-10-18" });
});

test("이동한 7일을 URL에 보존해 새로고침·다른 탭에서도 같은 날짜를 복구한다", () => {
    const previous = shiftRange(presetRange("7d", NOW), -1, NOW);
    const query = rangeSearchParams(previous, new URLSearchParams("tab=marketing&siteId=8&preset=7d"), NOW);
    assert.equal(query.get("tab"), "marketing");
    assert.equal(query.get("siteId"), "8");
    assert.equal(query.get("preset"), "7d");
    assert.equal(query.get("from"), "2026-10-05");
    assert.equal(query.get("to"), "2026-10-11");
    assert.deepEqual(rangeFromSearchParams(query, NOW), previous);
    query.set("tab", "behavior");
    assert.deepEqual(rangeFromSearchParams(query, NOW), previous);
});

test("최신 프리셋으로 돌아오면 오래된 날짜를 제거하고 사용자지정은 날짜를 남긴다", () => {
    const current = rangeSearchParams(presetRange("7d", NOW), new URLSearchParams("preset=7d&from=2026-10-05&to=2026-10-11"), NOW);
    assert.equal(current.toString(), "preset=7d");
    const custom: Range = { preset: "custom", from: "2026-10-01", to: "2026-10-03" };
    const query = rangeSearchParams(custom, current, NOW);
    assert.equal(query.has("preset"), false);
    assert.deepEqual(rangeFromSearchParams(query, NOW), custom);
});

test("잘못된 날짜·프리셋은 오늘로 복구하고 날짜 길이가 다르면 사용자지정으로 읽는다", () => {
    for (const query of ["", "preset=toString", "from=2026-02-30&to=2026-03-01", "from=2026-10-18&to=2026-10-17"]) {
        assert.deepEqual(rangeFromSearchParams(new URLSearchParams(query), NOW), presetRange("1d", NOW));
    }
    assert.deepEqual(rangeFromSearchParams(new URLSearchParams("preset=7d&from=2026-10-17&to=2026-10-18"), NOW), {
        preset: "custom", from: "2026-10-17", to: "2026-10-18",
    });
});
