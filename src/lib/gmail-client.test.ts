import { test, beforeEach } from "node:test";
import assert from "node:assert";
import {
    GMAIL_TOKEN_URL,
    GmailApiError,
    classify403,
    clearGmailTokenCache,
    createGmailClient,
    getAccessToken,
    scrubGmailError,
    type GmailCredentials,
} from "./gmail-client";
import { REPORT_PART_MAX_BYTES, STAGE1_HEADERS } from "./email-reply-rules";

// 가짜 값만 쓴다
const CFG: GmailCredentials = { clientId: "test-client-id", clientSecret: "test-secret-SSSS", refreshToken: "test-refresh-RRRR" };

type Handler = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown } | Error;

function fakeFetch(handler: Handler) {
    const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        calls.push({ url, init });
        const out = handler(url, init);
        if (out instanceof Error) throw out;
        return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { impl, calls };
}

const TOKEN_OK = { status: 200, body: { access_token: "ya29.fake-access-1", expires_in: 3600, token_type: "Bearer" } };

beforeEach(() => clearGmailTokenCache());

async function rejects(p: Promise<unknown>, code: string): Promise<GmailApiError> {
    try {
        await p;
    } catch (e) {
        assert.ok(e instanceof GmailApiError, `GmailApiError가 아님: ${String(e)}`);
        assert.equal(e.code, code);
        return e;
    }
    assert.fail(`${code} 오류가 나지 않았다`);
}

test("토큰: refresh_token 폼으로 받고 만료 60초 전까지 보관한다", async () => {
    let now = 1_000_000;
    const { impl, calls } = fakeFetch((url) => (url.href === GMAIL_TOKEN_URL ? TOKEN_OK : { status: 500, body: {} }));
    const t1 = await getAccessToken(CFG, impl, { now: () => now });
    assert.equal(t1, "ya29.fake-access-1");
    const form = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), CFG.refreshToken);
    now += 3600_000 - 61_000;
    await getAccessToken(CFG, impl, { now: () => now });
    assert.equal(calls.length, 1);
    now += 2_000;
    await getAccessToken(CFG, impl, { now: () => now });
    assert.equal(calls.length, 2);
});

test("토큰: invalid_grant → auth, 오류 글에 보안 비밀·갱신 토큰 없음 (R4)", async () => {
    const { impl } = fakeFetch(() => ({
        status: 400,
        body: { error: "invalid_grant", error_description: `Token has been expired or revoked. refresh_token=${CFG.refreshToken} secret ${CFG.clientSecret}` },
    }));
    const e = await rejects(getAccessToken(CFG, impl, { retryDelayMs: 0 }), "auth");
    assert.ok(!e.message.includes(CFG.refreshToken));
    assert.ok(!e.message.includes(CFG.clientSecret));
});

test("토큰: 5xx는 한 번 다시, 그래도면 transient", async () => {
    let n = 0;
    const { impl } = fakeFetch(() => (++n === 1 ? { status: 503, body: {} } : TOKEN_OK));
    assert.equal(await getAccessToken(CFG, impl, { retryDelayMs: 0 }), "ya29.fake-access-1");
    clearGmailTokenCache();
    const { impl: down } = fakeFetch(() => ({ status: 502, body: {} }));
    await rejects(getAccessToken(CFG, down, { retryDelayMs: 0 }), "transient");
});

test("1단계 요청 모양: 받는 사람·스레드 머리글 7개, snippet 없음, Bearer 토큰 (R5)", async () => {
    const { impl, calls } = fakeFetch((url) =>
        url.href === GMAIL_TOKEN_URL ? TOKEN_OK : { status: 200, body: { id: "m1", payload: { headers: [] } } }
    );
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    await client.getMessageRecipients("m1");
    const req = calls[1];
    assert.equal(req.url.origin, "https://gmail.googleapis.com");
    assert.equal(req.url.pathname, "/gmail/v1/users/me/messages/m1");
    assert.equal(req.url.searchParams.get("format"), "metadata");
    assert.deepEqual(req.url.searchParams.getAll("metadataHeaders"), [...STAGE1_HEADERS]);
    assert.ok(!(req.url.searchParams.get("fields") ?? "").includes("snippet"));
    assert.equal((req.init?.headers as Record<string, string>).authorization, "Bearer ya29.fake-access-1");
    assert.equal(client.calls(), 1);
});

test("오류 분류: history 404 → history_expired, 메시지 404 → null, 429 → rate_limited, 403 범위 → scope", async () => {
    const { impl } = fakeFetch((url) => {
        if (url.href === GMAIL_TOKEN_URL) return TOKEN_OK;
        if (url.pathname.endsWith("/history")) return { status: 404, body: { error: { code: 404, message: "Requested entity was not found." } } };
        if (url.pathname.endsWith("/gone")) return { status: 404, body: {} };
        if (url.pathname.endsWith("/busy")) return { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } };
        return { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }], message: "Insufficient Permission" } } };
    });
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    await rejects(client.listHistory("123"), "history_expired");
    assert.equal(await client.getMessageFull("gone"), null);
    await rejects(client.getMessageFull("busy"), "rate_limited");
    await rejects(client.getProfile(), "scope");
    assert.equal(classify403(["userRateLimitExceeded"]), "rate_limited");
    assert.equal(classify403(["accessNotConfigured"]), "config");
    assert.equal(classify403(["forbidden"]), "auth");
});

test("오류 분류: 401은 새 토큰으로 한 번 다시, 그래도면 auth", async () => {
    let tokens = 0;
    const { impl } = fakeFetch((url) => {
        if (url.href === GMAIL_TOKEN_URL) return { status: 200, body: { access_token: `ya29.t${++tokens}`, expires_in: 3600 } };
        return { status: 401, body: { error: { message: "Invalid Credentials" } } };
    });
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    await rejects(client.getProfile(), "auth");
    assert.equal(tokens, 2);
});

test("오류 분류: 5xx·연결 오류는 1.5초 뒤 한 번 다시(시험 0초), 그래도면 transient", async () => {
    let n = 0;
    const { impl } = fakeFetch((url) => {
        if (url.href === GMAIL_TOKEN_URL) return TOKEN_OK;
        n++;
        return n === 1 ? new Error("fetch failed") : { status: 200, body: { emailAddress: "ceo@matchesplan.test", historyId: "777" } };
    });
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    assert.deepEqual(await client.getProfile(), { emailAddress: "ceo@matchesplan.test", historyId: "777" });
    const { impl: down } = fakeFetch((url) => (url.href === GMAIL_TOKEN_URL ? TOKEN_OK : { status: 500, body: {} }));
    await rejects(createGmailClient(CFG, down, { retryDelayMs: 0 }).getProfile(), "transient");
});

test("보고 부분: 64KB 넘으면 버린다 (M9)", async () => {
    const big = Buffer.alloc(REPORT_PART_MAX_BYTES + 10, 65).toString("base64url");
    const { impl } = fakeFetch((url) => {
        if (url.href === GMAIL_TOKEN_URL) return TOKEN_OK;
        if (url.pathname.endsWith("/attachments/small")) return { status: 200, body: { size: 3, data: "QUJD" } };
        return { status: 200, body: { size: REPORT_PART_MAX_BYTES + 10, data: big } };
    });
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    assert.deepEqual(await client.getReportPart("m1", "small"), { size: 3, data: "QUJD" });
    assert.equal(await client.getReportPart("m1", "big"), null);
});

test("목록 요청: includeSpamTrash=true, history는 messageAdded만", async () => {
    const { impl, calls } = fakeFetch((url) =>
        url.href === GMAIL_TOKEN_URL ? TOKEN_OK : { status: 200, body: { historyId: "900", messages: [] } }
    );
    const client = createGmailClient(CFG, impl, { retryDelayMs: 0 });
    await client.listMessages("after:1 -in:sent");
    await client.listHistory("800", "next");
    assert.equal(calls[1].url.searchParams.get("includeSpamTrash"), "true");
    assert.equal(calls[1].url.searchParams.get("q"), "after:1 -in:sent");
    assert.equal(calls[2].url.searchParams.get("historyTypes"), "messageAdded");
    assert.equal(calls[2].url.searchParams.get("startHistoryId"), "800");
    assert.equal(calls[2].url.searchParams.get("pageToken"), "next");
});

test("비밀값 지우기: 토큰·쿼리·Bearer", () => {
    const out = scrubGmailError(
        `bad https://oauth2.googleapis.com/token?refresh_token=abc&x=1 Bearer ya29.zzz access_token=qq "client_secret":"s3" ${CFG.clientSecret}`,
        [CFG.clientSecret]
    );
    assert.ok(!out.includes("abc"));
    assert.ok(!out.includes("ya29.zzz"));
    assert.ok(!out.includes("qq"));
    assert.ok(!out.includes("s3"));
    assert.ok(!out.includes(CFG.clientSecret));
    assert.match(out, /https:\/\/oauth2\.googleapis\.com\/token/);
});
