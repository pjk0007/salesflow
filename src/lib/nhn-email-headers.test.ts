import { test } from "node:test";
import assert from "node:assert";
import {
    createDroppedHeaderWarner,
    NHN_CUSTOM_HEADER_VALUE_MAX_BYTES,
    NHN_FORBIDDEN_CUSTOM_HEADERS,
    sanitizeNhnCustomHeaders,
    withSafeCustomHeaders,
} from "./nhn-email-headers";
import type { DroppedHeader } from "./nhn-email-headers";

// NHN eachMail 사용자 지정 헤더 거르기 — 2026-10-04 Reply-To 하나로 워크스페이스의 모든 메일이 거절된 일을 다시 겪지 않게

// buildListUnsubscribeHeaders(email-unsubscribe.ts)가 만드는 모양 그대로 (그 파일은 DB를 열어 여기서 부르지 않는다)
const UNSUB = {
    "List-Unsubscribe": "<https://sendb.kr/api/email/unsubscribe/one-click?token=unsub_x>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};

/** NhnEmailSendRequest와 같은 모양 (nhn-email.ts는 DB를 열어 여기서 부르지 않는다) */
interface SendRequest {
    senderAddress: string;
    senderName?: string;
    title: string;
    body: string;
    receiverList: Array<{ receiveMailAddr: string; receiveType: "MRT0" }>;
    customHeaders?: Record<string, string>;
}

function baseRequest(): SendRequest {
    return {
        senderAddress: "cs@matchesplan.me",
        senderName: "매치스플랜",
        title: "제목",
        body: "<p>본문</p>",
        receiverList: [{ receiveMailAddr: "to@example.com", receiveType: "MRT0" }],
    };
}

/** 대소문자 바꾼 모양: 그대로, 모두 소문자, 모두 대문자, 한 글자씩 번갈아 */
function caseVariants(name: string): string[] {
    const alternating = [...name].map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase())).join("");
    return [...new Set([name, name.toLowerCase(), name.toUpperCase(), alternating])];
}

test("금지 목록은 NHN 콘솔 안내의 18개 이름 그대로", () => {
    assert.deepEqual(
        [...NHN_FORBIDDEN_CUSTOM_HEADERS].sort(),
        [
            "Bcc",
            "Cc",
            "Content-Description",
            "Content-Disposition",
            "Content-ID",
            "Content-MD5",
            "Content-Transfer-Encoding",
            "Date",
            "From",
            "In-Reply-To",
            "MIME-Version",
            "Message-ID",
            "Newsgroups",
            "References",
            "Reply-To",
            "Sender",
            "Subject",
            "To",
        ].sort()
    );
});

test("금지 이름은 대소문자와 상관없이 모두 뺀다 (List-Unsubscribe는 남긴다)", () => {
    for (const forbidden of NHN_FORBIDDEN_CUSTOM_HEADERS) {
        for (const name of caseVariants(forbidden)) {
            const out = sanitizeNhnCustomHeaders({ ...UNSUB, [name]: "ceo@matchesplan.com" });
            assert.deepEqual(out.customHeaders, UNSUB, name);
            assert.deepEqual(out.dropped, [{ name, reason: "forbidden" }], name);
        }
    }
});

test("금지 이름만 있으면 customHeaders 칸 자체가 없다", () => {
    assert.deepEqual(sanitizeNhnCustomHeaders({ "Reply-To": "ceo@matchesplan.com" }), {
        dropped: [{ name: "Reply-To", reason: "forbidden" }],
    });
});

test("이름 형식(영문·숫자·하이픈 1~50자)이 아니면 뺀다", () => {
    const bad = ["", "X Header", "X_Header", "X-Header:", "X.Header", "헤더", "X-Header\r\nBcc", "a".repeat(51)];
    for (const name of bad) {
        const out = sanitizeNhnCustomHeaders({ [name]: "v", ...UNSUB });
        assert.deepEqual(out.customHeaders, UNSUB, JSON.stringify(name));
        assert.deepEqual(out.dropped, [{ name, reason: "invalid-name" }], JSON.stringify(name));
    }
    // 경계: 50자·숫자·하이픈은 받는다
    const ok = sanitizeNhnCustomHeaders({ ["a".repeat(50)]: "v", "X-Campaign-2026": "1", "-": "x" });
    assert.equal(ok.dropped.length, 0);
    assert.deepEqual(Object.keys(ok.customHeaders ?? {}), ["a".repeat(50), "X-Campaign-2026", "-"]);
});

test("값이 비었거나 1000바이트를 넘거나 줄바꿈·NUL이 있거나 문자열이 아니면 뺀다", () => {
    const max = "a".repeat(NHN_CUSTOM_HEADER_VALUE_MAX_BYTES);
    // 한글은 3바이트 — 334자면 1002바이트
    const korean = "가".repeat(334);
    const cases: Array<[string, unknown]> = [
        ["empty", ""],
        ["too-long", `${max}a`],
        ["korean-too-long", korean],
        ["crlf", "a\r\nBcc: evil@x.com"],
        ["lf", "a\nb"],
        ["nul", "a\0b"],
        ["number", 1],
        ["null", null],
        ["object", { a: 1 }],
    ];
    for (const [label, value] of cases) {
        const out = sanitizeNhnCustomHeaders({ "X-Test": value, ...UNSUB });
        assert.deepEqual(out.customHeaders, UNSUB, label);
        assert.deepEqual(out.dropped, [{ name: "X-Test", reason: "invalid-value" }], label);
    }
    // 경계: 정확히 1000바이트는 받는다
    assert.deepEqual(sanitizeNhnCustomHeaders({ "X-Test": max }).customHeaders, { "X-Test": max });
});

test("대소문자만 다른 같은 이름은 먼저 나온 것만 남긴다", () => {
    const out = sanitizeNhnCustomHeaders({ ...UNSUB, "list-unsubscribe": "<https://evil.example/>" });
    assert.deepEqual(out.customHeaders, UNSUB);
    assert.deepEqual(out.dropped, [{ name: "list-unsubscribe", reason: "duplicate" }]);
});

test("List-Unsubscribe·List-Unsubscribe-Post는 이름·값·순서를 바꾸지 않고 남긴다", () => {
    const out = sanitizeNhnCustomHeaders({ ...UNSUB });
    assert.deepEqual(out, { customHeaders: UNSUB, dropped: [] });
    assert.deepEqual(Object.keys(out.customHeaders ?? {}), ["List-Unsubscribe", "List-Unsubscribe-Post"]);
});

test("빈 객체·null·undefined → customHeaders 칸 없음", () => {
    assert.deepEqual(sanitizeNhnCustomHeaders({}), { dropped: [] });
    assert.deepEqual(sanitizeNhnCustomHeaders(null), { dropped: [] });
    assert.deepEqual(sanitizeNhnCustomHeaders(undefined), { dropped: [] });
});

// ── 발송 요청 단위 (NhnEmailClient.sendEachMail이 보내기 직전에 부른다) ──

function collectWarn() {
    const calls: DroppedHeader[][] = [];
    return { calls, warn: (d: readonly DroppedHeader[]) => calls.push([...d]) };
}

test("수신거부 헤더만 있는 지금의 요청은 그대로 — 같은 객체, 같은 JSON 본문 (바이트까지 같다)", () => {
    const { calls, warn } = collectWarn();
    const req = { ...baseRequest(), customHeaders: { ...UNSUB } };
    const before = JSON.stringify(req);
    const out = withSafeCustomHeaders(req, warn);
    assert.equal(out, req);
    assert.equal(JSON.stringify(out), before);
    assert.deepEqual(calls, []);
});

test("customHeaders 칸이 없는 요청(테스트 발송 등)은 그대로", () => {
    const { calls, warn } = collectWarn();
    const req = baseRequest();
    assert.equal(withSafeCustomHeaders(req, warn), req);
    assert.deepEqual(calls, []);
});

test("빈 객체 customHeaders는 칸을 빼고 보낸다 (경고 없음)", () => {
    const { calls, warn } = collectWarn();
    const out = withSafeCustomHeaders({ ...baseRequest(), customHeaders: {} }, warn);
    assert.equal("customHeaders" in out, false);
    assert.deepEqual(out, baseRequest());
    assert.deepEqual(calls, []);
});

test("Reply-To가 섞이면 그 헤더만 빼고 나머지는 그대로 보낸다 — 메일은 나간다", () => {
    const { calls, warn } = collectWarn();
    const req = { ...baseRequest(), customHeaders: { ...UNSUB, "Reply-To": "ceo@matchesplan.com" } };
    const out = withSafeCustomHeaders(req, warn);
    assert.deepEqual(out, { ...baseRequest(), customHeaders: UNSUB });
    assert.deepEqual(calls, [[{ name: "Reply-To", reason: "forbidden" }]]);
    // 넘긴 요청은 바꾸지 않는다
    assert.deepEqual(req.customHeaders, { ...UNSUB, "Reply-To": "ceo@matchesplan.com" });
});

test("모두 빠지면 customHeaders 칸 없이 보낸다", () => {
    const { calls, warn } = collectWarn();
    const out = withSafeCustomHeaders({ ...baseRequest(), customHeaders: { "reply-to": "a@b.com", From: "x@y.com" } }, warn);
    assert.equal("customHeaders" in out, false);
    assert.deepEqual(out, baseRequest());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].map((d) => d.name), ["reply-to", "From"]);
});

// ── 경고는 (이름, 까닭)마다 한 번 ──

test("경고: 같은 헤더는 한 번만 남기고, 값은 적지 않는다", () => {
    const lines: string[] = [];
    const warnOnce = createDroppedHeaderWarner((m) => lines.push(m));
    for (let i = 0; i < 5; i++) {
        withSafeCustomHeaders({ ...baseRequest(), customHeaders: { ...UNSUB, "Reply-To": "secret-value@x.com" } }, warnOnce);
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /"Reply-To" \(forbidden\)/);
    assert.equal(lines[0].includes("secret-value"), false);

    // 대소문자만 다른 같은 이름도 같은 경고다. 다른 이름·다른 까닭은 따로 한 번
    warnOnce([{ name: "REPLY-TO", reason: "forbidden" }]);
    assert.equal(lines.length, 1);
    warnOnce([{ name: "From", reason: "forbidden" }, { name: "X-Test", reason: "invalid-value" }]);
    warnOnce([{ name: "From", reason: "forbidden" }]);
    assert.equal(lines.length, 3);
});

test("경고: 이상한 이름은 60자까지만 적는다", () => {
    const lines: string[] = [];
    const warnOnce = createDroppedHeaderWarner((m) => lines.push(m));
    warnOnce([{ name: `X${"y".repeat(200)}`, reason: "invalid-name" }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes("y".repeat(60)), false);
    assert.equal(lines[0].includes("y".repeat(59)), true);
});
