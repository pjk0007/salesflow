import { test } from "node:test";
import assert from "node:assert";
import { resolveRange, rangeBounds, previousRange, isValidYmd } from "./date-range";

// now를 고정 주입한다 — Date.now()에 의존하면 기본값 계약을 고정할 수 없다
const NOW = new Date("2026-09-01T05:00:00Z");

// ── resolveRange — B12 ──

test("둘 다 생략하면 최근 30일이다 (B12)", () => {
    assert.deepEqual(resolveRange(null, null, NOW), { fromYmd: "2026-08-02", toYmd: "2026-09-01" });
});

test("to만 생략하면 오늘까지다 (B12)", () => {
    assert.equal(resolveRange("2026-07-01", null, NOW).toYmd, "2026-09-01");
});

test("from만 생략하면 30일 전부터다 (B12)", () => {
    assert.equal(resolveRange(null, "2026-08-15", NOW).fromYmd, "2026-08-02");
});

test("둘 다 주면 그대로 쓴다", () => {
    assert.deepEqual(resolveRange("2026-01-01", "2026-01-31", NOW), {
        fromYmd: "2026-01-01",
        toYmd: "2026-01-31",
    });
});

test("빈 문자열은 미지정과 같다", () => {
    assert.deepEqual(resolveRange("", "", NOW), { fromYmd: "2026-08-02", toYmd: "2026-09-01" });
});

test("undefined도 미지정과 같다", () => {
    assert.deepEqual(resolveRange(undefined, undefined, NOW), {
        fromYmd: "2026-08-02",
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

// ── previousRange ──

test("직전 동일 길이 기간을 만든다", () => {
    // 8/1~8/31 = 31일 → 직전 31일은 7/1~7/31
    assert.deepEqual(previousRange("2026-08-01", "2026-08-31"), {
        fromYmd: "2026-07-01",
        toYmd: "2026-07-31",
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
