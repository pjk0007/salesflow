import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKeyParts, formatDateTime, formatDayKey, formatTimeKst, kstDateKey } from "./format";

// UX-205 — 여정 날짜 그룹·시각은 브라우저 시간대가 아니라 KST로 묶고 보여 준다

function inZones<T>(run: () => T): T[] {
    const original = process.env.TZ;
    try {
        return ["Asia/Seoul", "UTC", "America/Los_Angeles", "Australia/Sydney"].map((tz) => {
            process.env.TZ = tz;
            return run();
        });
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
}

const AT = {
    "23:59": "2026-10-31T14:59:00.000Z", // 10-31 23:59 KST
    "00:00": "2026-10-31T15:00:00.000Z", // 11-01 00:00 KST
    "08:59": "2026-10-31T23:59:00.000Z", // 11-01 08:59 KST
    "09:00": "2026-11-01T00:00:00.000Z", // 11-01 09:00 KST
};

test("날짜 키는 KST 날짜다 — 23:59·00:00·08:59·09:00 KST, 월말", () => {
    for (const keys of inZones(() => Object.values(AT).map(kstDateKey))) {
        assert.deepEqual(keys, ["2026-10-31", "2026-11-01", "2026-11-01", "2026-11-01"]);
    }
});

test("행 시각과 날짜 묶음이 같은 KST 기준이다 (해외 브라우저 포함)", () => {
    for (const rows of inZones(() => Object.values(AT).map((iso) => [kstDateKey(iso), formatTimeKst(iso), formatDateTime(iso)]))) {
        assert.deepEqual(rows.map((r) => r[1]), ["23:59", "00:00", "08:59", "09:00"]);
        // formatDateTime의 월·일이 날짜 키와 일치
        for (const [key, , text] of rows) {
            const { month, day } = dayKeyParts(key);
            assert.match(text, new RegExp(`^${String(month).padStart(2, "0")}\. ${String(day).padStart(2, "0")}\.`));
        }
    }
});

test("날짜 키 라벨은 시간대 변환 없이 읽는다 — 요일·차트 축", () => {
    for (const parts of inZones(() => [dayKeyParts("2026-11-01"), formatDayKey("2026-11-01")])) {
        assert.deepEqual(parts, [{ month: 11, day: 1, weekday: "일" }, "11. 01."]);
    }
    assert.deepEqual(dayKeyParts("2024-02-29"), { month: 2, day: 29, weekday: "목" });
});
