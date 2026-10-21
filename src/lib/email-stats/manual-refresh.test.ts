import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { manualRefreshDecision } from "./manual-refresh";

test("B31: 수동 갱신은 마지막 시각부터 5분 쿨다운", () => {
    const now = new Date("2026-10-21T03:00:00Z");
    assert.deepEqual(manualRefreshDecision(null, now), { allowed: true });
    assert.deepEqual(manualRefreshDecision(new Date("2026-10-21T02:55:00Z"), now), { allowed: true });
    assert.deepEqual(manualRefreshDecision(new Date("2026-10-21T02:59:01Z"), now), {
        allowed: false, retryAfterSec: 241, error: "5분 뒤 다시 갱신할 수 있습니다.",
    });
});

test("수동 갱신 예약 연결은 nested loop를 끄고 RESET 실패에도 잠금을 해제한다", () => {
    const source = readFileSync(new URL("./refresh-store.ts", import.meta.url), "utf8");
    assert.match(source, /await conn\.unsafe\("SET enable_nestloop = off"\)/);
    assert.match(source, /try\s*\{\s*await conn\.unsafe\("RESET enable_nestloop"\);\s*\} finally\s*\{/);
    const reset = source.indexOf('"RESET enable_nestloop"');
    const unlock = source.indexOf('"SELECT pg_advisory_unlock($1)"');
    assert.ok(reset < unlock);
    assert.match(source.slice(unlock), /finally\s*\{\s*conn\.release\(\)/);
});
