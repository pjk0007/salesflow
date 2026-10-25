import test from "node:test";
import assert from "node:assert/strict";
import { reconnectWindow } from "./reconnect-window";
test("UX-127 최초 연결과 7/30일 재연결 공백을 구분한다", () => {
    const now = Date.parse("2026-10-25T00:00:00Z");
    assert.deepEqual(reconnectWindow(null, now), { days: 0, beyondWindow: false });
    assert.deepEqual(reconnectWindow("invalid", now), { days: 0, beyondWindow: false });
    assert.deepEqual(reconnectWindow("2026-10-18T00:00:00Z", now), { days: 7, beyondWindow: false });
    assert.deepEqual(reconnectWindow("2026-10-17T23:59:59Z", now), { days: 30, beyondWindow: false });
    assert.deepEqual(reconnectWindow("2026-09-25T00:00:00Z", now), { days: 30, beyondWindow: false });
    assert.deepEqual(reconnectWindow("2026-09-24T23:59:59Z", now), { days: 30, beyondWindow: true });
});
