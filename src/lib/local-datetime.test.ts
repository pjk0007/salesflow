import test from "node:test";
import assert from "node:assert/strict";
import { dateTimeInputToIso, localDateTimeValue } from "./utils";

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

test("UX-296 예정 시각을 건드리지 않고 저장하면 DST 종료 중복 시각도 원래 순간을 유지한다", () => {
    const original = process.env.TZ;
    try {
        process.env.TZ = "America/New_York";
        // 2026-11-01 01:30은 EDT(05:30Z)와 EST(06:30Z) 두 번 있다 — 두 번째(EST) 순간을 보관한 할 일
        const due = "2026-11-01T06:30:00.000Z";
        const shown = localDateTimeValue(due);
        assert.equal(shown, "2026-11-01T01:30");
        assert.equal(dateTimeInputToIso(shown, due), due);
        // 사용자가 바꾼 값은 입력대로 저장
        assert.equal(dateTimeInputToIso("2026-11-02T09:00", due), "2026-11-02T14:00:00.000Z");
        // 비우기·새 값·잘못된 값
        assert.equal(dateTimeInputToIso("", due), null);
        assert.equal(dateTimeInputToIso("2026-07-15T12:00", null), "2026-07-15T16:00:00.000Z");
        assert.equal(dateTimeInputToIso("invalid", null), null);
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
});
