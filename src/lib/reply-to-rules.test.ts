import { test } from "node:test";
import assert from "node:assert";
import {
    classifyMxError,
    classifyMxRecords,
    emailDomain,
    isReservedMailDomain,
    isValidReplyToEmail,
    mxCacheTtlMs,
    MX_CACHE_TTL_MS,
    MX_NONE_TTL_MS,
    MX_UNKNOWN_TTL_MS,
    normalizeReplyToInput,
    poolSenderEntries,
} from "./reply-to-rules";
import type { SenderMxEntry } from "./reply-to-rules";

// DESIGN-3 — 답장 받는 곳. 2026-10-04 NHN이 Reply-To 사용자 지정 헤더를 거절해 발송 헤더 만들기는 없앴다.
// 남은 것: 워크스페이스 설정 API 입력 검사(R4), MX 해석, 규칙 화면의 발신 묶음 주소 고르기

// ── R4: 저장할 값 검사 ──

test("R4: 형식이 맞으면 저장 (앞뒤 공백 제거, 도메인 소문자, 로컬 부분은 그대로)", () => {
    assert.deepEqual(normalizeReplyToInput("  CEO@MatchesPlan.COM "), { ok: true, value: "CEO@matchesplan.com" });
    assert.deepEqual(normalizeReplyToInput("sales+kr@mail.company.co.kr"), { ok: true, value: "sales+kr@mail.company.co.kr" });
    assert.deepEqual(normalizeReplyToInput("a@xn--3e0b707e.kr"), { ok: true, value: "a@xn--3e0b707e.kr" });
    // 앞뒤 줄바꿈은 공백처럼 지운다 — 저장 값에는 남지 않는다
    assert.deepEqual(normalizeReplyToInput("ceo@matchesplan.com\r\n"), { ok: true, value: "ceo@matchesplan.com" });
});

test("R4: null·빈 문자열·공백은 지우기 (null = 답장 주소 없음)", () => {
    assert.deepEqual(normalizeReplyToInput(null), { ok: true, value: null });
    assert.deepEqual(normalizeReplyToInput(""), { ok: true, value: null });
    assert.deepEqual(normalizeReplyToInput("   "), { ok: true, value: null });
});

test("R4: 잘못된 형식은 거절 (API가 400으로 돌려준다)", () => {
    const bad = [
        "ceo",
        "ceo@",
        "@matchesplan.com",
        "ceo@matchesplan",
        "ceo@@matchesplan.com",
        "a@b@c.com",
        "ceo @matchesplan.com",
        "ceo@matches plan.com",
        "ceo@match\nesplan.com",
        "a@x.com\r\nBcc: e@x.com",
        "a@x.com,b@x.com",
        "<a@x.com>",
        "\"a\"@x.com",
        ".a@x.com",
        "a.@x.com",
        "a..b@x.com",
        "a@-x.com",
        "a@x-.com",
        "a@x..com",
        "a@x.c",
        "a@x.123",
        "대표@matchesplan.com",
        "a@회사.kr",
    ];
    for (const v of bad) {
        const r = normalizeReplyToInput(v);
        assert.equal(r.ok, false, `거절해야 함: ${JSON.stringify(v)}`);
        if (!r.ok) assert.match(r.error, /형식/);
    }
});

test("R4: 200자를 넘으면 거절, 200자 안이면 받음", () => {
    const domain = "@matchesplan.com"; // 16자
    const local64 = "a".repeat(64);
    const longDomain = `${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(53)}.com`; // 179자
    const ok = `${"a".repeat(20)}@${longDomain}`; // 200자
    assert.equal(ok.length, 200);
    assert.deepEqual(normalizeReplyToInput(ok), { ok: true, value: ok });
    const tooLong = `a${ok}`;
    const r = normalizeReplyToInput(tooLong);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /200자/);
    // 로컬 부분 64자 넘음
    assert.equal(isValidReplyToEmail(`${local64}${domain}`), true);
    assert.equal(isValidReplyToEmail(`${local64}a${domain}`), false);
});

test("R4: 문자열이 아니면 거절", () => {
    for (const v of [123, true, {}, ["a@x.com"]]) {
        const r = normalizeReplyToInput(v);
        assert.equal(r.ok, false);
        if (!r.ok) assert.match(r.error, /문자열/);
    }
});

// ── MX 해석·예약 도메인 ──

test("emailDomain: 마지막 @ 뒤, 소문자. 형식이 아니면 null", () => {
    assert.equal(emailDomain("ceo@MatchesPlan.com"), "matchesplan.com");
    assert.equal(emailDomain(" a@b@C.com "), "c.com");
    assert.equal(emailDomain("no-at"), null);
    assert.equal(emailDomain("@x.com"), null);
    assert.equal(emailDomain("x@"), null);
    assert.equal(emailDomain(null), null);
});

test("MX 레코드 해석: 받는 서버가 있으면 ok, 비었거나 null MX(RFC 7505)뿐이면 none", () => {
    assert.equal(classifyMxRecords([{ exchange: "aspmx.l.google.com", priority: 1 }]), "ok");
    assert.equal(classifyMxRecords([{ exchange: "", priority: 0 }, { exchange: "mx.x.com", priority: 10 }]), "ok");
    assert.equal(classifyMxRecords([]), "none");
    assert.equal(classifyMxRecords(null), "none");
    assert.equal(classifyMxRecords([{ exchange: "", priority: 0 }]), "none");
    assert.equal(classifyMxRecords([{ exchange: ".", priority: 0 }]), "none");
});

test("MX 오류 해석: 이름 없음·MX 없음은 none, 시간 초과·서버 실패는 unknown", () => {
    assert.equal(classifyMxError("ENODATA"), "none");
    assert.equal(classifyMxError("ENOTFOUND"), "none");
    assert.equal(classifyMxError("ETIMEOUT"), "unknown");
    assert.equal(classifyMxError("ESERVFAIL"), "unknown");
    assert.equal(classifyMxError("ECONNREFUSED"), "unknown");
    assert.equal(classifyMxError(undefined), "unknown");
});

test("MX 캐시 기간: ok 하루, none·unknown 10분 (MX를 연결하면 10분 안에 안내가 걷힌다 — REVIEW-4 F1)", () => {
    assert.equal(mxCacheTtlMs("ok"), MX_CACHE_TTL_MS);
    assert.equal(mxCacheTtlMs("none"), MX_NONE_TTL_MS);
    assert.equal(mxCacheTtlMs("unknown"), MX_UNKNOWN_TTL_MS);
    assert.equal(MX_CACHE_TTL_MS, 86_400_000);
    assert.equal(MX_NONE_TTL_MS, 600_000);
    assert.equal(MX_UNKNOWN_TTL_MS, 600_000);
});

test("예약 도메인(.test·.example·.invalid·.localhost·example.com)은 메일을 받지 않는다", () => {
    for (const d of ["dh-mail1.test", "x.example", "a.invalid", "localhost", "foo.localhost", "example.com", "mail.example.org", "EXAMPLE.NET."]) {
        assert.equal(isReservedMailDomain(d), true, d);
    }
    for (const d of ["matchesplan.com", "matchesplan.me", "sendb.kr", "testing.com", "example.co.kr"]) {
        assert.equal(isReservedMailDomain(d), false, d);
    }
});

// ── 규칙 수정 화면: 묶음이 실제로 쓸 주소 ──

const senders: SenderMxEntry[] = [
    { profileId: 1, fromEmail: "a@matchesplan.me", domain: "matchesplan.me", mx: "none", isDefault: false },
    { profileId: 2, fromEmail: "b@matchesplan.com", domain: "matchesplan.com", mx: "ok", isDefault: true },
    { profileId: 3, fromEmail: "c@sendb.kr", domain: "sendb.kr", mx: "none", isDefault: true },
    { profileId: null, fromEmail: "legacy@old.kr", domain: "old.kr", mx: "unknown", isDefault: false },
];

test("묶음 주소: 묶음 순서대로 이 조직 주소만, 중복·없는 id는 뺀다", () => {
    assert.deepEqual(poolSenderEntries([3, 1, 3, 99, null], senders).map((s) => s.profileId), [3, 1]);
});

test("묶음이 비었거나 없는 주소뿐이면 기본 주소(id가 가장 작은 기본), 없으면 설정 발신자 — 발송과 같다", () => {
    assert.deepEqual(poolSenderEntries([], senders).map((s) => s.profileId), [2]);
    assert.deepEqual(poolSenderEntries([99], senders).map((s) => s.profileId), [2]);
    const noDefault = senders.map((s) => ({ ...s, isDefault: false }));
    assert.deepEqual(poolSenderEntries([], noDefault).map((s) => s.profileId), [null]);
    assert.deepEqual(poolSenderEntries([], []), []);
});
