import test from "node:test";
import assert from "node:assert/strict";
import {
    defaultCalendar,
    calendarInput,
    zonedBoundary,
    addBusinessMilliseconds,
    businessMilliseconds,
    businessAvailability,
} from "./calendar";
const dt = (value: string) => new Date(value),
    mins = (n: number) => n * 60000;
test("마감 전 문의는 다음 업무시간으로 목표가 이어진다", () => {
    const c = defaultCalendar();
    assert.equal(
        addBusinessMilliseconds(
            c,
            dt("2026-10-16T17:50:00+09:00"),
            mins(15),
        ).toISOString(),
        "2026-10-19T00:05:00.000Z",
    );
});
test("주말·휴무일·점심 구간은 제외한다", () => {
    const c = {
        ...defaultCalendar(),
        holidays: ["2026-10-19"],
        weekly: [1, 2, 3, 4, 5].flatMap((day) => [
            { day, start: "09:00", end: "12:00" },
            { day, start: "13:00", end: "18:00" },
        ]),
    };
    assert.equal(
        addBusinessMilliseconds(
            c,
            dt("2026-10-16T17:50:00+09:00"),
            mins(15),
        ).toISOString(),
        "2026-10-20T00:05:00.000Z",
    );
    assert.equal(
        businessMilliseconds(
            c,
            dt("2026-10-20T11:50:00+09:00"),
            dt("2026-10-20T13:10:00+09:00"),
        ),
        mins(20),
    );
});
test("열림 상태와 다음 시작 시각은 종료 경계를 포함하지 않는다", () => {
    const c = defaultCalendar();
    assert.equal(
        businessAvailability(c, dt("2026-10-16T17:59:00+09:00")).open,
        true,
    );
    assert.deepEqual(businessAvailability(c, dt("2026-10-16T18:00:00+09:00")), {
        open: false,
        nextOpenAt: "2026-10-19T00:00:00.000Z",
    });
});
test("잘못된 시간대·날짜·겹침·빈 업무시간은 저장하지 않는다", () => {
    const c = defaultCalendar();
    for (const bad of [
        { ...c, timezone: "unknown/foo" },
        { ...c, holidays: ["2026-02-30"] },
        { ...c, weekly: [] },
        { ...c, weekly: [{ day: 1, start: "09:00", end: "09:00" }] },
        {
            ...c,
            weekly: [
                { day: 1, start: "09:00", end: "12:00" },
                { day: 1, start: "11:00", end: "13:00" },
            ],
        },
    ])
        assert.equal(calendarInput.safeParse(bad).success, false);
});
test("DST 봄의 빠진 시간은 실제 경과만 계산하고 누락 경계는 다음 유효 분으로 이동", () => {
    const c = {
        timezone: "America/New_York",
        weekly: [{ day: 0, start: "01:00", end: "04:00" }],
        holidays: [],
    };
    assert.equal(
        businessMilliseconds(
            c,
            dt("2026-03-08T00:00:00-05:00"),
            dt("2026-03-08T05:00:00-04:00"),
        ),
        mins(120),
    );
    assert.equal(
        zonedBoundary("2026-03-08", "02:30", c.timezone).toISOString(),
        "2026-03-08T07:00:00.000Z",
    );
});
test("DST 가을의 반복 시간은 UTC 구간을 합쳐 중복 집계하지 않는다", () => {
    const c = {
        timezone: "America/New_York",
        weekly: [
            { day: 0, start: "01:00", end: "01:30" },
            { day: 0, start: "01:30", end: "02:00" },
        ],
        holidays: [],
    };
    assert.equal(
        businessMilliseconds(
            c,
            dt("2026-11-01T00:00:00-04:00"),
            dt("2026-11-01T03:00:00-05:00"),
        ),
        mins(120),
    );
});
test("24시간·날짜 경계·역순과 소수초 보존", () => {
    const c = {
            timezone: "Asia/Seoul",
            weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
                day,
                start: "00:00",
                end: "24:00",
            })),
            holidays: [],
        },
        from = dt("2026-10-15T23:59:59.500+09:00");
    assert.equal(
        addBusinessMilliseconds(c, from, 1500).toISOString(),
        "2026-10-15T15:00:01.000Z",
    );
    assert.equal(
        businessMilliseconds(c, from, new Date(from.getTime() + 1500)),
        1500,
    );
    assert.equal(
        businessMilliseconds(c, from, new Date(from.getTime() - 1)),
        0,
    );
});
test("다양한 업무시간에서 목표를 더한 기간의 업무시간이 일치", () => {
    const c = defaultCalendar();
    for (const from of [
        "2026-10-16T08:01:01+09:00",
        "2026-10-16T17:59:59+09:00",
        "2026-10-17T12:00:00+09:00",
    ])
        for (const minutes of [1, 61, 541, 6000]) {
            const start = dt(from),
                end = addBusinessMilliseconds(c, start, mins(minutes));
            assert.equal(businessMilliseconds(c, start, end), mins(minutes));
        }
});
