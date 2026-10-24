import { test } from "node:test";
import assert from "node:assert";
import {
    resolveRange,
    rangeBounds,
    previousRange,
    isValidYmd,
    kstDayStartIso,
    kstDayEndIso,
    DEFAULT_RANGE_DAYS,
    kstDateFilter,
    INVALID_YMD_ERROR,
} from "./date-range";

// now를 고정 주입한다 — Date.now()에 의존하면 기본값 계약을 고정할 수 없다
const NOW = new Date("2026-09-01T05:00:00Z");

// ── resolveRange — B12, UX-212(QA-03) ──
// 기대값 변경(UX-212): 이전에는 UTC 날짜에서 30일을 빼 양 끝 포함 31일(08-02~09-01)이었다.
// 이제 오늘(KST)을 포함한 30일(08-03~09-01)이고, 오늘은 서버 시간대가 아닌 KST 날짜다.

function inclusiveDays(r: { fromYmd: string; toYmd: string }): number {
    return (Date.parse(`${r.toYmd}T00:00:00Z`) - Date.parse(`${r.fromYmd}T00:00:00Z`)) / 86_400_000 + 1;
}

test("둘 다 생략하면 오늘(KST) 포함 최근 30일이다 (B12·UX-212)", () => {
    const r = resolveRange(null, null, NOW);
    assert.deepEqual(r, { fromYmd: "2026-08-03", toYmd: "2026-09-01" });
    assert.equal(inclusiveDays(r), DEFAULT_RANGE_DAYS);
});

test("기본 기간의 오늘은 KST 날짜다 — 00:00·08:59·09:00 KST (UX-212)", () => {
    // KST 2026-10-18 00:00 = UTC 10-17 15:00 → UTC 날짜로는 아직 어제다
    for (const iso of ["2026-10-17T15:00:00Z", "2026-10-17T23:59:00Z", "2026-10-18T00:00:00Z"]) {
        const r = resolveRange(null, null, new Date(iso));
        assert.equal(r.toYmd, "2026-10-18", iso);
        assert.equal(r.fromYmd, "2026-09-19", iso);
        assert.equal(inclusiveDays(r), 30, iso);
    }
    // KST 10-17 23:59는 아직 10-17
    assert.equal(resolveRange(null, null, new Date("2026-10-17T14:59:00Z")).toYmd, "2026-10-17");
});

test("기본 기간은 월말·윤년을 넘겨도 30일이다 (UX-212)", () => {
    // KST 2024-03-01 00:30 — 윤년 2월 29일을 포함
    const leap = resolveRange(null, null, new Date("2024-02-29T15:30:00Z"));
    assert.deepEqual(leap, { fromYmd: "2024-02-01", toYmd: "2024-03-01" });
    assert.equal(inclusiveDays(leap), 30);
    // KST 2026-03-01 08:59 — 평년
    const common = resolveRange(null, null, new Date("2026-02-28T23:59:00Z"));
    assert.deepEqual(common, { fromYmd: "2026-01-31", toYmd: "2026-03-01" });
    // KST 2027-01-01 00:00 — 연말 넘김
    assert.deepEqual(resolveRange(null, null, new Date("2026-12-31T15:00:00Z")), {
        fromYmd: "2026-12-03",
        toYmd: "2027-01-01",
    });
});

test("기본 기간은 실행 환경 시간대와 무관하다 (UX-212 해외 시간대)", () => {
    const original = process.env.TZ;
    const at = new Date("2026-10-17T15:30:00Z"); // KST 10-18 00:30
    const results: unknown[] = [];
    try {
        for (const tz of ["UTC", "America/Los_Angeles", "Asia/Seoul", "Pacific/Kiritimati"]) {
            process.env.TZ = tz;
            results.push(resolveRange(null, null, at));
        }
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
    for (const r of results) assert.deepEqual(r, { fromYmd: "2026-09-19", toYmd: "2026-10-18" });
});

test("to만 생략하면 오늘까지다 (B12)", () => {
    assert.equal(resolveRange("2026-07-01", null, NOW).toYmd, "2026-09-01");
});

test("from만 생략하면 오늘 포함 30일의 시작부터다 (B12)", () => {
    assert.equal(resolveRange(null, "2026-08-15", NOW).fromYmd, "2026-08-03");
});

test("둘 다 주면 그대로 쓴다", () => {
    assert.deepEqual(resolveRange("2026-01-01", "2026-01-31", NOW), {
        fromYmd: "2026-01-01",
        toYmd: "2026-01-31",
    });
});

test("빈 문자열은 미지정과 같다", () => {
    assert.deepEqual(resolveRange("", "", NOW), { fromYmd: "2026-08-03", toYmd: "2026-09-01" });
});

test("undefined도 미지정과 같다", () => {
    assert.deepEqual(resolveRange(undefined, undefined, NOW), {
        fromYmd: "2026-08-03",
        toYmd: "2026-09-01",
    });
});

// ── rangeBounds — 웹 route와 문자 단위로 같아야 한다 ──

test("KST 자정 경계를 만든다", () => {
    assert.deepEqual(rangeBounds("2026-08-01", "2026-08-31"), {
        fromIso: "2026-08-01T00:00:00+09:00",
        toIso: "2026-08-31T23:59:59.999+09:00",
    });
});

test("한쪽 날짜만 있는 필터도 같은 KST 경계를 쓴다", () => {
    assert.equal(kstDayStartIso("2026-10-18"), rangeBounds("2026-10-18", "2026-10-18").fromIso);
    assert.equal(kstDayEndIso("2026-10-18"), rangeBounds("2026-10-18", "2026-10-18").toIso);
});

test("KST 경계는 00:00·08:59·09:00·23:59 KST 순간을 그날로 포함하고 다음 날 00:00은 뺀다", () => {
    const { fromIso, toIso } = rangeBounds("2026-10-18", "2026-10-18");
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    const inRange = (iso: string) => Date.parse(iso) >= from && Date.parse(iso) <= to;
    assert.equal(inRange("2026-10-17T14:59:59.999Z"), false); // 10-17 23:59:59.999 KST
    assert.equal(inRange("2026-10-17T15:00:00Z"), true); // 10-18 00:00 KST
    assert.equal(inRange("2026-10-17T23:59:00Z"), true); // 10-18 08:59 KST
    assert.equal(inRange("2026-10-18T00:00:00Z"), true); // 10-18 09:00 KST
    assert.equal(inRange("2026-10-18T14:59:00Z"), true); // 10-18 23:59 KST
    assert.equal(inRange("2026-10-18T15:00:00Z"), false); // 10-19 00:00 KST
});

// ── kstDateFilter — 발송 이력 시작일·종료일 (UX-198·149·185) ──

function filterAll(start: string | null, end: string | null, sentAt: string[]): string[] {
    const r = kstDateFilter(start, end);
    assert.ok(r.ok);
    return sentAt.filter(
        (iso) =>
            (!r.fromIso || Date.parse(iso) >= Date.parse(r.fromIso)) &&
            (!r.toIso || Date.parse(iso) <= Date.parse(r.toIso))
    );
}

const SENT = [
    "2026-10-17T14:59:00Z", // 10-17 23:59 KST
    "2026-10-17T15:00:00Z", // 10-18 00:00 KST
    "2026-10-17T23:59:00Z", // 10-18 08:59 KST
    "2026-10-18T00:00:00Z", // 10-18 09:00 KST
    "2026-10-18T14:59:00Z", // 10-18 23:59 KST
    "2026-10-18T15:00:00Z", // 10-19 00:00 KST
    "2026-10-18T23:00:00Z", // 10-19 08:00 KST — 예전에는 종료일 10-18에 섞였다
];

test("하루 지정: KST 그날 00:00~23:59만 나온다 (자정 전후 포함/제외)", () => {
    assert.deepEqual(filterAll("2026-10-18", "2026-10-18", SENT), SENT.slice(1, 5));
});

test("시작일만·종료일만 지정해도 KST 경계다", () => {
    assert.deepEqual(filterAll("2026-10-18", null, SENT), SENT.slice(1));
    assert.deepEqual(filterAll(null, "2026-10-18", SENT), SENT.slice(0, 5));
});

test("날짜 미입력·빈 문자열은 전체다", () => {
    assert.deepEqual(kstDateFilter(null, null), { ok: true, fromIso: null, toIso: null });
    assert.deepEqual(kstDateFilter("", ""), { ok: true, fromIso: null, toIso: null });
    assert.deepEqual(filterAll(null, null, SENT), SENT);
});

test("월말·윤년 하루도 KST 경계다", () => {
    assert.deepEqual(kstDateFilter("2024-02-29", "2024-02-29"), {
        ok: true,
        fromIso: "2024-02-29T00:00:00+09:00",
        toIso: "2024-02-29T23:59:59.999+09:00",
    });
    const monthEnd = ["2026-10-31T14:59:00Z", "2026-10-31T15:00:00Z"]; // 10-31 23:59, 11-01 00:00 KST
    assert.deepEqual(filterAll("2026-10-31", "2026-10-31", monthEnd), monthEnd.slice(0, 1));
});

test("형식이 틀린 날짜는 한국어 오류다 (서버 시간대 해석·500 방지)", () => {
    for (const [start, end] of [["2026-10-18T00:00", null], [null, "2026/10/18"], ["2026-02-30", null], ["오늘", null]] as const) {
        assert.deepEqual(kstDateFilter(start, end), { ok: false, error: INVALID_YMD_ERROR });
    }
});

test("발송 이력 경계는 실행 환경 시간대와 무관하다", () => {
    const original = process.env.TZ;
    const results: unknown[] = [];
    try {
        for (const tz of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
            process.env.TZ = tz;
            const r = kstDateFilter("2026-10-18", "2026-10-18");
            assert.ok(r.ok && r.fromIso && r.toIso);
            results.push([new Date(r.fromIso).toISOString(), new Date(r.toIso).toISOString()]);
        }
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
    for (const r of results) assert.deepEqual(r, ["2026-10-17T15:00:00.000Z", "2026-10-18T14:59:59.999Z"]);
});

// ── previousRange ──

test("직전 동일 길이 기간을 만든다", () => {
    // 8/1~8/31 = 31일 → 직전 31일은 7/1~7/31
    assert.deepEqual(previousRange("2026-08-01", "2026-08-31"), {
        fromYmd: "2026-07-01",
        toYmd: "2026-07-31",
    });
});

test("직전 기간은 윤년 2월을 넘긴다", () => {
    assert.deepEqual(previousRange("2024-03-01", "2024-03-07"), {
        fromYmd: "2024-02-23",
        toYmd: "2024-02-29",
    });
});

test("하루짜리 기간의 직전은 전날 하루다", () => {
    assert.deepEqual(previousRange("2026-08-10", "2026-08-10"), {
        fromYmd: "2026-08-09",
        toYmd: "2026-08-09",
    });
});

// ── isValidYmd — MCP 전용 방어 ──

test("올바른 YMD를 통과시킨다", () => {
    assert.equal(isValidYmd("2026-08-01"), true);
});

test("한국어 기간 표현을 거부한다", () => {
    // Claude가 "지난달"을 그대로 넣으면 Postgres가 예외를 던진다
    assert.equal(isValidYmd("지난달"), false);
});

test("ISO 타임스탬프를 거부한다", () => {
    assert.equal(isValidYmd("2026-08-01T00:00:00Z"), false);
});

test("존재하지 않는 날짜를 거부한다", () => {
    // 정규식만으로는 통과한다 — 실제 파싱 결과까지 대조해야 잡힌다
    assert.equal(isValidYmd("2026-02-30"), false);
    assert.equal(isValidYmd("2026-13-01"), false);
});

test("자리수가 다른 형식을 거부한다", () => {
    assert.equal(isValidYmd("2026-8-1"), false);
});

test("빈 문자열을 거부한다", () => {
    assert.equal(isValidYmd(""), false);
});
