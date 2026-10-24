import { test } from "node:test";
import assert from "node:assert";
import {
    addDaysYmd,
    countByKstDate,
    formatKstDateTime,
    formatKstHm,
    formatKstShort,
    isBusinessHours,
    kstParts,
    kstRecentDaysStart,
    kstToDate,
    nextBusinessStart,
    nextWeekdayYmd,
    weekdayOfYmd,
} from "./kst";

// 2026-10-01은 목요일, 10-02 금요일, 10-03 토요일, 10-05 월요일이다

// ── kstParts·kstToDate ──

test("UTC 15:30은 한국 다음 날 00:30이다", () => {
    assert.deepEqual(kstParts(new Date("2026-10-01T15:30:00Z")), {
        date: "2026-10-02",
        hour: 0,
        minute: 30,
        weekday: 5,
    });
});

test("kstToDate는 한국 시각을 UTC 순간으로 바꾼다", () => {
    assert.equal(kstToDate("2026-10-05", 9).toISOString(), "2026-10-05T00:00:00.000Z");
    assert.equal(kstToDate("2026-10-05", 18, 30).toISOString(), "2026-10-05T09:30:00.000Z");
    // 한국 자정은 UTC 전날 15:00
    assert.equal(kstToDate("2026-11-01", 0).toISOString(), "2026-10-31T15:00:00.000Z");
});

// ── addDaysYmd·요일 ──

test("addDaysYmd는 달·해를 넘긴다", () => {
    assert.equal(addDaysYmd("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysYmd("2028-02-28", 1), "2028-02-29");
});

test("요일과 다음 평일", () => {
    assert.equal(weekdayOfYmd("2026-10-01"), 4);
    assert.equal(nextWeekdayYmd("2026-10-01"), "2026-10-02");
    assert.equal(nextWeekdayYmd("2026-10-02"), "2026-10-05");
    assert.equal(nextWeekdayYmd("2026-10-03"), "2026-10-05");
    assert.equal(nextWeekdayYmd("2026-10-04"), "2026-10-05");
});

// ── formatKstShort ──

test("formatKstShort는 월·일 앞 0 없이, 시·분은 두 자리로 쓴다", () => {
    assert.equal(formatKstShort(new Date("2026-01-05T00:07:00Z")), "1/5 09:07");
    assert.equal(formatKstShort(new Date("2026-10-02T05:20:00+09:00")), "10/2 05:20");
    assert.equal(formatKstHm(new Date("2026-10-02T05:20:00+09:00")), "05:20");
});

test("formatKstShort는 UTC 연말 밤을 한국 새해로 쓴다", () => {
    assert.equal(formatKstShort(new Date("2026-12-31T15:00:00Z")), "1/1 00:00");
});

// ── isBusinessHours ──

test("금요일 17:59는 근무시간, 18:00은 아니다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-02T17:59:00+09:00")), true);
    assert.equal(isBusinessHours(new Date("2026-10-02T18:00:00+09:00")), false);
});

test("월요일 08:59는 근무시간이 아니고 09:00부터다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-05T08:59:00+09:00")), false);
    assert.equal(isBusinessHours(new Date("2026-10-05T09:00:00+09:00")), true);
});

test("토요일 낮은 근무시간이 아니다", () => {
    assert.equal(isBusinessHours(new Date("2026-10-03T11:00:00+09:00")), false);
});

test("UTC로는 금요일이어도 한국이 토요일이면 근무시간이 아니다", () => {
    // 2026-10-02T15:30Z = 한국 10/3(토) 00:30
    assert.equal(isBusinessHours(new Date("2026-10-02T15:30:00Z")), false);
});

// ── nextBusinessStart ──

test("근무시간 안이면 그 순간 그대로", () => {
    const now = new Date("2026-10-01T14:20:00+09:00");
    assert.equal(nextBusinessStart(now).getTime(), now.getTime());
});

test("일요일 밤은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-04T23:30:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("금요일 18:00은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-02T18:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("평일 09:00 전이면 그날 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-05T08:59:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

test("목요일 밤은 금요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-01T21:00:00+09:00")).toISOString(),
        new Date("2026-10-02T09:00:00+09:00").toISOString()
    );
});

test("토요일은 월요일 09:00", () => {
    assert.equal(
        nextBusinessStart(new Date("2026-10-03T10:00:00+09:00")).toISOString(),
        new Date("2026-10-05T09:00:00+09:00").toISOString()
    );
});

// ── kstRecentDaysStart — "오늘"·"최근 N일" 하한 (UX-040·185·200) ──

function withTimeZones<T>(zones: string[], run: () => T): T[] {
    const original = process.env.TZ;
    try {
        return zones.map((tz) => {
            process.env.TZ = tz;
            return run();
        });
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
}

const ZONES = ["UTC", "Asia/Seoul", "America/Los_Angeles", "Europe/London"];

test("오늘의 시작은 KST 00:00이다 — 00:00·08:59·09:00·23:59 KST", () => {
    const start = "2026-10-17T15:00:00.000Z"; // 2026-10-18 00:00 KST
    for (const iso of ["2026-10-17T15:00:00Z", "2026-10-17T23:59:00Z", "2026-10-18T00:00:00Z", "2026-10-18T14:59:59Z"]) {
        assert.equal(kstRecentDaysStart(new Date(iso)).toISOString(), start, iso);
    }
    // KST 10-17 23:59:59 는 아직 10-17
    assert.equal(kstRecentDaysStart(new Date("2026-10-17T14:59:59Z")).toISOString(), "2026-10-16T15:00:00.000Z");
});

test("KST 오전 9시 전 발송도 오늘에 포함된다 (서버가 UTC일 때 빠지던 경우)", () => {
    const now = new Date("2026-10-18T02:00:00Z"); // 11:00 KST
    const sentAt = new Date("2026-10-17T16:30:00Z"); // 01:30 KST 같은 날
    const since = kstRecentDaysStart(now);
    assert.ok(sentAt >= since);
    // 전날 23:30 KST 발송은 빠진다
    assert.ok(new Date("2026-10-17T14:30:00Z") < since);
});

test("최근 N일은 오늘 포함 N개 KST 날짜의 첫날 00:00부터다 — 월말·윤년", () => {
    const now = new Date("2026-10-18T00:30:00Z"); // 10-18 09:30 KST
    assert.equal(kstRecentDaysStart(now, 7).toISOString(), "2026-10-11T15:00:00.000Z"); // 10-12 00:00 KST
    assert.equal(kstRecentDaysStart(now, 30).toISOString(), "2026-09-18T15:00:00.000Z"); // 09-19 00:00 KST
    // 2024-03-01 00:30 KST, 윤년: 7일 = 02-24 ~ 03-01
    assert.equal(kstRecentDaysStart(new Date("2024-02-29T15:30:00Z"), 7).toISOString(), "2024-02-23T15:00:00.000Z");
    // 2026-03-01 08:59 KST, 평년: 7일 = 02-23 ~ 03-01
    assert.equal(kstRecentDaysStart(new Date("2026-02-28T23:59:00Z"), 7).toISOString(), "2026-02-22T15:00:00.000Z");
});

test("오늘의 시작은 서버 프로세스 시간대와 무관하다", () => {
    const now = new Date("2026-10-17T16:00:00Z"); // 10-18 01:00 KST
    const results = withTimeZones(ZONES, () => kstRecentDaysStart(now).toISOString());
    for (const r of results) assert.equal(r, "2026-10-17T15:00:00.000Z");
});

// ── formatKstDateTime — 내보내기 값 (UX-073) ──

test("내보내기 일시는 KST다 — 화면 09:30은 파일에도 09:30", () => {
    assert.equal(formatKstDateTime(new Date("2026-10-18T00:30:00Z")), "2026-10-18 09:30");
    assert.equal(formatKstDateTime(new Date("2026-10-17T15:30:00Z")), "2026-10-18 00:30");
    const results = withTimeZones(ZONES, () => formatKstDateTime(new Date("2026-12-31T15:00:00Z")));
    for (const r of results) assert.equal(r, "2027-01-01 00:00");
});

// ── 날짜만 있는 값의 저장·조회 라운드트립 (UX-169 지식 확인일) ──

test("KST 날짜 → KST 자정 저장 → KST 날짜 읽기는 하루도 밀리지 않는다 — 월말·연말·윤년·반복 복제", () => {
    for (const ymd of ["2026-10-31", "2026-12-31", "2027-01-01", "2024-02-29", "2026-03-01"]) {
        let value = ymd;
        for (let copy = 0; copy < 3; copy++) {
            const stored = kstToDate(value, 0).toISOString();
            value = kstParts(new Date(stored)).date;
        }
        assert.equal(value, ymd);
    }
    // 이전 방식(ISO 앞 10자리)은 하루 앞당겨졌다
    assert.equal(kstToDate("2026-10-18", 0).toISOString().slice(0, 10), "2026-10-17");
});

test("확인일 라운드트립은 브라우저 시간대와 무관하다", () => {
    const results = withTimeZones(ZONES, () => kstParts(new Date(kstToDate("2026-10-18", 0).toISOString())).date);
    for (const r of results) assert.equal(r, "2026-10-18");
});

// ── countByKstDate — 일별 활동량 (UX-205) ──

test("일별 집계는 KST 날짜로 묶는다 — 23:59·00:00·08:59·09:00 KST·월말", () => {
    const events = [
        "2026-10-31T14:59:00Z", // 10-31 23:59 KST
        "2026-10-31T15:00:00Z", // 11-01 00:00 KST
        "2026-10-31T23:59:00Z", // 11-01 08:59 KST
        "2026-11-01T00:00:00Z", // 11-01 09:00 KST
    ];
    assert.deepEqual(countByKstDate(events), [
        { date: "2026-10-31", count: 1 },
        { date: "2026-11-01", count: 3 },
    ]);
    const total = countByKstDate(events).reduce((a, b) => a + b.count, 0);
    assert.equal(total, events.length);
    const results = withTimeZones(ZONES, () => countByKstDate(events.map((e) => new Date(e))));
    for (const r of results) assert.deepEqual(r, countByKstDate(events));
});
