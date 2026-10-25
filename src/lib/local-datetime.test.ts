import test from "node:test";
import assert from "node:assert/strict";
import { localDateTimeValue } from "./utils";

test("UX-296 datetime-local은 현재 날짜와 상관없이 예정일의 DST 오프셋을 사용한다", () => {
    const original = process.env.TZ;
    try {
        for (const [zone, cases] of [
            ["America/New_York", [["2026-01-15T17:00:00Z", "2026-01-15T12:00"], ["2026-07-15T16:00:00Z", "2026-07-15T12:00"], ["2026-03-08T06:59:00Z", "2026-03-08T01:59"], ["2026-03-08T07:00:00Z", "2026-03-08T03:00"]]],
            ["Asia/Seoul", [["2026-01-15T17:00:00Z", "2026-01-16T02:00"]]],
            ["UTC", [["2026-01-15T17:00:00Z", "2026-01-15T17:00"]]],
        ] as const) {
            process.env.TZ = zone;
            for (const [iso, expected] of cases) {
                const local = localDateTimeValue(iso);
                assert.equal(local, expected);
                assert.equal(new Date(local).toISOString(), new Date(iso).toISOString());
            }
        }
        assert.equal(localDateTimeValue(null), "");
        assert.equal(localDateTimeValue("invalid"), "");
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
});
