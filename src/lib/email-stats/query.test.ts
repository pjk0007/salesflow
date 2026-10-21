import test from "node:test";
import assert from "node:assert/strict";
import { parseStatsQuery } from "./query";
const NOW = new Date("2026-10-21T03:00:00Z");
const query = (changes: Record<string, string> = {}) => new URLSearchParams({ view: "compare", from: "2026-09-22", to: "2026-10-21", ...changes });
const failures: [Record<string, string>, string][] = [
    [{ from: "2026-10-21", to: "2026-10-20" }, "조회 기간의 시작일과 종료일을 확인해 주세요."],
    [{ to: "2026-10-22" }, "오늘 이후 날짜는 볼 수 없습니다."],
    [{ from: "2025-10-20" }, "조회 기간은 366일까지입니다."],
    [{ from: "2026-02-30" }, "조회 기간의 시작일과 종료일을 확인해 주세요."],
    [{ view: "x" }, "보기 종류를 확인해 주세요."],
    [{ axis: "x" }, "비교 축을 확인해 주세요."],
    ...["abc", "0", "-1", "1.5"].map(workspaceId => [{ workspaceId }, "워크스페이스를 확인해 주세요."] as [Record<string, string>, string]),
];
for (const [changes, error] of failures) test(`B12: 잘못된 검색 조건 ${JSON.stringify(changes)}`, () => {
    assert.deepEqual(parseStatsQuery(query(changes), NOW), { ok: false, error });
});
test("B12: 성공 union의 기본 축, 빈 workspace, 포함 일수", () => {
    assert.deepEqual(parseStatsQuery(query({ workspaceId: "" }), NOW), { ok: true, view: "compare", from: "2026-09-22", to: "2026-10-21", days: 30, workspaceId: null, axis: "campaign" });
    assert.deepEqual(parseStatsQuery(query({ workspaceId: "7", axis: "sender", from: "2025-10-21" }), NOW), { ok: true, view: "compare", from: "2025-10-21", to: "2026-10-21", days: 366, workspaceId: 7, axis: "sender" });
});
