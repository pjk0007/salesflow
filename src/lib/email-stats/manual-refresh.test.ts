import test from "node:test";
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
