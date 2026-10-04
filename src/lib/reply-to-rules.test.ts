import { test } from "node:test";
import assert from "node:assert";
import {
    buildCustomHeaders,
    classifyMxError,
    classifyMxRecords,
    createReplyToResolver,
    emailDomain,
    isReservedMailDomain,
    isValidReplyToEmail,
    mxCacheTtlMs,
    MX_CACHE_TTL_MS,
    MX_UNKNOWN_TTL_MS,
    normalizeReplyToInput,
    poolSenderEntries,
    REPLY_TO_HEADER,
    replyToHeaderValue,
} from "./reply-to-rules";
import type { SenderMxEntry } from "./reply-to-rules";

// DESIGN-3 — 사업(워크스페이스)별 답장 받을 주소 (R1~R6)

const UNSUB = {
    "List-Unsubscribe": "<https://sendb.kr/api/email/unsubscribe/one-click?token=unsub_x>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};

// ── R1·R2·R6: 발송 헤더 ──

test("R1: 답장 주소가 있으면 Reply-To 헤더가 그 값", () => {
    assert.deepEqual(buildCustomHeaders({ replyTo: "ceo@matchesplan.com" }), {
        customHeaders: { "Reply-To": "ceo@matchesplan.com" },
    });
    assert.equal(REPLY_TO_HEADER, "Reply-To");
});

test("R2: 답장 주소가 비면 Reply-To 없음 — 수신거부 헤더도 없으면 customHeaders 칸 자체가 없다 (지금과 같은 요청)", () => {
    assert.deepEqual(buildCustomHeaders({}), {});
    assert.deepEqual(buildCustomHeaders({ replyTo: null, listUnsubscribe: null }), {});
    assert.deepEqual(buildCustomHeaders({ replyTo: "" }), {});
    assert.deepEqual(buildCustomHeaders({ replyTo: "   " }), {});
    // 수신거부만 있으면 예전과 똑같은 헤더
    assert.deepEqual(buildCustomHeaders({ listUnsubscribe: UNSUB, replyTo: null }), { customHeaders: UNSUB });
});

test("R6: 기존 List-Unsubscribe 헤더와 함께 들어간다 (넘긴 객체는 바꾸지 않는다)", () => {
    const base = { ...UNSUB };
    const out = buildCustomHeaders({ listUnsubscribe: base, replyTo: "cs@company.co.kr" });
    assert.deepEqual(out, { customHeaders: { ...UNSUB, "Reply-To": "cs@company.co.kr" } });
    assert.deepEqual(base, UNSUB);
});

test("Reply-To는 한 번만 — 대소문자가 다른 같은 이름 헤더를 지우고 넣는다", () => {
    const out = buildCustomHeaders({ listUnsubscribe: { "reply-to": "old@x.com", ...UNSUB }, replyTo: "new@x.com" });
    assert.deepEqual(out.customHeaders, { ...UNSUB, "Reply-To": "new@x.com" });
});

test("헤더 주입 막기: 저장된 값에 줄바꿈·쉼표·꺾쇠가 있으면 헤더를 넣지 않는다", () => {
    assert.deepEqual(buildCustomHeaders({ replyTo: "a@x.com\r\nBcc: evil@x.com" }), {});
    assert.deepEqual(buildCustomHeaders({ replyTo: "a@x.com, b@x.com" }), {});
    assert.deepEqual(buildCustomHeaders({ replyTo: "Name <a@x.com>" }), {});
    assert.equal(replyToHeaderValue(" ceo@matchesplan.com "), "ceo@matchesplan.com");
    assert.equal(replyToHeaderValue(null), null);
    assert.equal(replyToHeaderValue(undefined), null);
});

// ── R4: 저장할 값 검사 ──

test("R4: 형식이 맞으면 저장 (앞뒤 공백 제거, 도메인 소문자, 로컬 부분은 그대로)", () => {
    assert.deepEqual(normalizeReplyToInput("  CEO@MatchesPlan.COM "), { ok: true, value: "CEO@matchesplan.com" });
    assert.deepEqual(normalizeReplyToInput("sales+kr@mail.company.co.kr"), { ok: true, value: "sales+kr@mail.company.co.kr" });
    assert.deepEqual(normalizeReplyToInput("a@xn--3e0b707e.kr"), { ok: true, value: "a@xn--3e0b707e.kr" });
    // 앞뒤 줄바꿈은 공백처럼 지운다 — 저장 값에는 남지 않는다
    assert.deepEqual(normalizeReplyToInput("ceo@matchesplan.com\r\n"), { ok: true, value: "ceo@matchesplan.com" });
});

test("R2·R4: null·빈 문자열·공백은 지우기 (null = 헤더 없음)", () => {
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

// ── R3: 레코드의 워크스페이스 기준, 섞이지 않음 + 회차 캐시 ──

function fakeLoaders(values: Record<number, string | null>, partitionWs: Record<number, number | null> = {}) {
    const calls = { workspace: [] as number[], partition: [] as number[] };
    return {
        calls,
        loaders: {
            loadWorkspaceReplyTo: async (id: number) => {
                calls.workspace.push(id);
                return values[id] ?? null;
            },
            loadPartitionWorkspaceId: async (id: number) => {
                calls.partition.push(id);
                return partitionWs[id] ?? null;
            },
        },
    };
}

test("R3: 워크스페이스마다 그 워크스페이스 값 — 다른 워크스페이스의 답장 주소가 섞이지 않는다", async () => {
    const { loaders } = fakeLoaders({ 1: "a@biz-a.com", 2: "b@biz-b.com", 3: null });
    const r = createReplyToResolver(loaders);
    const got = await Promise.all([1, 2, 3, 1, 2].map((ws) => r.forWorkspace(ws)));
    assert.deepEqual(got, ["a@biz-a.com", "b@biz-b.com", null, "a@biz-a.com", "b@biz-b.com"]);
});

test("회차 캐시: 같은 워크스페이스는 한 번만 읽는다 (동시에 물어도)", async () => {
    const { loaders, calls } = fakeLoaders({ 1: "a@biz-a.com", 2: null });
    const r = createReplyToResolver(loaders);
    await Promise.all([r.forWorkspace(1), r.forWorkspace(1), r.forWorkspace(2)]);
    await r.forWorkspace(1);
    await r.forWorkspace(2);
    assert.deepEqual(calls.workspace.sort(), [1, 2]);
});

test("레코드가 없을 때 파티션의 워크스페이스로 찾는다 (파티션·워크스페이스 모두 캐시)", async () => {
    const { loaders, calls } = fakeLoaders({ 7: "cs@biz.com" }, { 70: 7, 71: 7, 99: null });
    const r = createReplyToResolver(loaders);
    assert.equal(await r.forPartition(70), "cs@biz.com");
    assert.equal(await r.forPartition(70), "cs@biz.com");
    assert.equal(await r.forPartition(71), "cs@biz.com");
    assert.equal(await r.forPartition(99), null);
    assert.equal(await r.forPartition(null), null);
    assert.deepEqual(calls.partition, [70, 71, 99]);
    assert.deepEqual(calls.workspace, [7]);
});

test("id가 없거나 잘못이면 조회하지 않고 null", async () => {
    const { loaders, calls } = fakeLoaders({});
    const r = createReplyToResolver(loaders);
    for (const v of [null, undefined, 0, -1, 1.5, Number.NaN]) {
        assert.equal(await r.forWorkspace(v as number), null);
    }
    assert.deepEqual(calls.workspace, []);
});

test("저장된 값이 형식에 맞지 않으면 null (헤더를 넣지 않는다)", async () => {
    const { loaders } = fakeLoaders({ 1: "broken\r\nvalue", 2: "  ok@biz.com  " });
    const r = createReplyToResolver(loaders);
    assert.equal(await r.forWorkspace(1), null);
    assert.equal(await r.forWorkspace(2), "ok@biz.com");
});

test("prime: 이미 읽은 워크스페이스 값은 다시 조회하지 않는다", async () => {
    const { loaders, calls } = fakeLoaders({ 1: "db@biz.com" });
    const r = createReplyToResolver(loaders);
    r.prime(1, "primed@biz.com");
    assert.equal(await r.forWorkspace(1), "primed@biz.com");
    r.prime(2, null);
    assert.equal(await r.forWorkspace(2), null);
    assert.deepEqual(calls.workspace, []);
});

test("조회가 던지면 그대로 던지고 캐시에 남기지 않는다 (다음 줄은 다시 읽는다)", async () => {
    let fail = true;
    const r = createReplyToResolver({
        loadWorkspaceReplyTo: async () => {
            if (fail) throw new Error("db down");
            return "a@biz.com";
        },
        loadPartitionWorkspaceId: async () => 1,
    });
    await assert.rejects(r.forWorkspace(1), /db down/);
    fail = false;
    assert.equal(await r.forWorkspace(1), "a@biz.com");
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

test("MX 캐시 기간: ok·none 하루, unknown 10분", () => {
    assert.equal(mxCacheTtlMs("ok"), MX_CACHE_TTL_MS);
    assert.equal(mxCacheTtlMs("none"), MX_CACHE_TTL_MS);
    assert.equal(mxCacheTtlMs("unknown"), MX_UNKNOWN_TTL_MS);
    assert.equal(MX_CACHE_TTL_MS, 86_400_000);
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
