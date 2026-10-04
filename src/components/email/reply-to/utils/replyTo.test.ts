import { test } from "node:test";
import assert from "node:assert";
import {
    poolReplyNotice,
    REPLY_TO_NONE_LABEL,
    replyToFieldValue,
    replyToMxNotice,
    replyToSettingsHref,
    replyToSummary,
    TEST_SEND_NO_WORKSPACE,
    testSendWorkspaceId,
} from "./replyTo";

// DESIGN-3 3절 화면 — 워크스페이스 설정 칸(R2 비우기, R4 형식·MX 경고), 규칙 요약 칸 "답장", 발신 묶음 칸 안내

test("R2: 칸을 비우면 null로 저장한다 (Reply-To 헤더 없음 — 지금과 같음)", () => {
    assert.deepEqual(replyToFieldValue(""), { ok: true, value: null });
    assert.deepEqual(replyToFieldValue("   "), { ok: true, value: null });
});

test("R4: 칸 값은 서버와 같은 검사 — 앞뒤 공백을 지우고 도메인은 소문자, 형식이 아니면 오류 글", () => {
    assert.deepEqual(replyToFieldValue("  CEO@MatchesPlan.com "), { ok: true, value: "CEO@matchesplan.com" });
    for (const bad of ["ceo", "ceo@", "@matchesplan.com", "a b@x.com", "ceo@matchesplan", "x@y.com\r\nBcc: z@w.com"]) {
        const r = replyToFieldValue(bad);
        assert.equal(r.ok, false, bad);
        if (!r.ok) assert.match(r.error, /답장 받을 주소/);
    }
});

test("요약 칸: 주소가 있으면 그 주소, 없으면 '없음 — 답장이 발신 주소로 갑니다'", () => {
    assert.deepEqual(replyToSummary("ceo@matchesplan.com"), { text: "ceo@matchesplan.com", isSet: true });
    assert.deepEqual(replyToSummary(null), { text: REPLY_TO_NONE_LABEL, isSet: false });
    assert.deepEqual(replyToSummary(undefined), { text: REPLY_TO_NONE_LABEL, isSet: false });
    assert.deepEqual(replyToSummary("  "), { text: REPLY_TO_NONE_LABEL, isSet: false });
    assert.equal(REPLY_TO_NONE_LABEL, "없음 — 답장이 발신 주소로 갑니다");
});

test("R4: MX 없는 도메인은 저장되지만 노란 경고, 확인 못 함은 회색 안내, ok는 안내 없음", () => {
    const none = replyToMxNotice("none", "cs@matchesplan.me");
    assert.equal(none?.tone, "warning");
    assert.match(none!.text, /matchesplan\.me 도메인은 메일을 받는 서버\(MX\)가 없어/);
    assert.match(none!.text, /저장은 되었습니다/);

    const unknown = replyToMxNotice("unknown", "cs@example.com");
    assert.equal(unknown?.tone, "muted");
    assert.match(unknown!.text, /example\.com/);

    assert.equal(replyToMxNotice("ok", "ceo@matchesplan.com"), null);
    // 주소를 비워 저장했거나 옛 서버(mx 없음)
    assert.equal(replyToMxNotice(null, null), null);
    assert.equal(replyToMxNotice(undefined, "ceo@matchesplan.com"), null);
    assert.equal(replyToMxNotice("none", null), null);
});

const entries = [
    { domain: "matchesplan.me", mx: "none" as const },
    { domain: "MatchesPlan.me", mx: "none" as const },
    { domain: "matchesplan.com", mx: "ok" as const },
    { domain: "flaky.example", mx: "unknown" as const },
    { domain: null, mx: null },
    { domain: "sendb.kr", mx: "none" as const },
];

test("묶음 안내: 답장 주소가 비었고 MX 없는 도메인이 있으면 그 도메인들 (중복 없이, 묶음 순서)", () => {
    assert.deepEqual(poolReplyNotice(null, entries), { domains: ["matchesplan.me", "sendb.kr"] });
    assert.deepEqual(poolReplyNotice("", entries), { domains: ["matchesplan.me", "sendb.kr"] });
});

test("묶음 안내: 답장 주소가 있으면 안내 없음", () => {
    assert.equal(poolReplyNotice("ceo@matchesplan.com", entries), null);
});

test("묶음 안내: 모두 받거나(ok) 확인하지 못한(unknown·조회 안 함) 도메인뿐이면 안내 없음, 목록이 없어도 없음", () => {
    assert.equal(poolReplyNotice(null, entries.filter((e) => e.mx !== "none")), null);
    assert.equal(poolReplyNotice(null, []), null);
    assert.equal(poolReplyNotice(null, null), null);
    assert.equal(poolReplyNotice(null, undefined), null);
});

test("답장 받을 주소 정하기 링크는 그 워크스페이스를 골라 연다", () => {
    assert.equal(replyToSettingsHref(12), "/settings/workspace?tab=workspace&workspaceId=12");
    assert.equal(replyToSettingsHref(null), "/settings/workspace?tab=workspace");
});

test("R1·R2: 템플릿 테스트 발송 — 워크스페이스가 하나면 넘기지 않는다 (서버가 그 답장 주소를 쓴다)", () => {
    assert.equal(testSendWorkspaceId([5], TEST_SEND_NO_WORKSPACE), undefined);
    assert.equal(testSendWorkspaceId([5], "5"), undefined);
    assert.equal(testSendWorkspaceId([], "5"), undefined);
});

test("R1·R3: 템플릿 테스트 발송 — 여럿이면 고른 사업만 넘기고, 고르지 않았거나 목록에 없는 값이면 넘기지 않는다 (Reply-To 없음)", () => {
    assert.equal(testSendWorkspaceId([5, 9], "9"), 9);
    assert.equal(testSendWorkspaceId([5, 9], "5"), 5);
    assert.equal(testSendWorkspaceId([5, 9], TEST_SEND_NO_WORKSPACE), undefined);
    assert.equal(testSendWorkspaceId([5, 9], "7"), undefined);
    assert.equal(testSendWorkspaceId([5, 9], ""), undefined);
    assert.equal(testSendWorkspaceId([5, 9], "abc"), undefined);
});
