import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CHANNEL_SOURCE_VERSION,
    ChannelSourceHttpError,
    createChannelSourceRequest,
    type ChannelSourceHttpInput,
} from "./http";
const credentials = { accessKey: "fictional-access-key", accessSecret: "fictional-access-secret" };
const input = (patch: Partial<ChannelSourceHttpInput> = {}): ChannelSourceHttpInput => ({
    method: "GET", path: "/open/channel", headers: { "Channel-Version": CHANNEL_SOURCE_VERSION }, timeoutMs: 1000, ...patch,
});
function json(body: unknown = { channel: { id: "fake" } }, status = 200, headers: Record<string, string> = {}) {
    return Response.json(body, { status, headers: { "Channel-Version": CHANNEL_SOURCE_VERSION, ...headers } });
}
function code(expected: string, excludes: string[] = []) {
    return (error: unknown) => {
        assert.ok(error instanceof ChannelSourceHttpError);
        assert.equal(error.code, expected);
        const exposed = error.message + JSON.stringify(error);
        for (const value of excludes) assert.ok(!exposed.includes(value));
        assert.equal(error.cause, undefined);
        return true;
    };
}
test("공식 고정 origin·GET·버전·서버 인증 헤더만 사용하고 쿠키/redirect/cache 제외", async () => {
    let sent: { url: URL; init?: RequestInit } | undefined;
    const request = createChannelSourceRequest({ ...credentials, fetch: async (url, init) => {
        sent = { url: new URL(String(url)), init };
        return json();
    }});
    assert.equal((await request(input())).status, 200);
    assert.equal(sent?.url.origin, "https://api.channel.io");
    assert.equal(sent?.url.pathname, "/open/channel");
    assert.ok(!sent?.url.href.includes(credentials.accessKey));
    assert.equal(sent?.init?.method, "GET");
    assert.equal(sent?.init?.redirect, "error");
    assert.equal(sent?.init?.credentials, "omit");
    assert.equal(sent?.init?.cache, "no-store");
    const headers = new Headers(sent?.init?.headers);
    assert.equal(headers.get("x-access-key"), credentials.accessKey);
    assert.equal(headers.get("x-access-secret"), credentials.accessSecret);
    assert.equal(headers.get("Channel-Version"), CHANNEL_SOURCE_VERSION);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(sent?.init?.body, undefined);
});
test("자료 수집에 쓰는 channel/managers/사용자 detail/문의 detail·messages·file 경로 허용", async () => {
    const paths = ["/open/channel", "/open/bots", "/open/managers", "/open/managers/manager-1", "/open/users/user-1", "/open/users/user-1/user-chats", "/open/user-chats", "/open/user-chats/chat-1", "/open/user-chats/chat-1/messages", "/open/user-chats/chat-1/messages/file"];
    let count = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { count++; return json(); } });
    for (const path of paths) await request(input({ path }));
    assert.equal(count, paths.length);
});
test("encoded 사용자 ID와 파일 key/opaque cursor를 경로·쿼리 경계 그대로 인코딩", async () => {
    const urls: URL[] = [];
    const request = createChannelSourceRequest({ ...credentials, fetch: async (url) => { urls.push(new URL(String(url))); return json(); } });
    const id = "고객:A+%B";
    await request(input({ path: "/open/users/" + encodeURIComponent(id), query: { cursor: "opaque+/=?#한글", limit: 50, ascending: false, ignored: undefined } }));
    assert.equal(decodeURIComponent(urls[0].pathname.split("/").at(-1)!), id);
    assert.equal(urls[0].searchParams.get("cursor"), "opaque+/=?#한글");
    assert.equal(urls[0].searchParams.get("limit"), "50");
    assert.equal(urls[0].searchParams.get("ascending"), "false");
    assert.equal(urls[0].searchParams.has("ignored"), false);
    const key = "2026/가상 제안서%2F.pdf?signature=not-a-secret+&x=1#part";
    await request(input({ path: "/open/user-chats/chat-1/messages/file", query: { key } }));
    assert.equal(urls[1].pathname, "/open/user-chats/chat-1/messages/file");
    assert.equal(urls[1].searchParams.get("key"), key);
    assert.equal(urls[1].searchParams.size, 1);
    assert.equal(urls[1].hash, "");
});
test("v5·쓰기·임의 URL·전체 users·경로 우회는 인증 요청 전에 거절", async () => {
    let calls = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { calls++; return json(); } });
    for (const path of ["https://other.example.test/open/channel", "//other.example.test/open/channel", "/open/v5/channel", "/open/users", "/open/users/user-1/touch", "/open/users/user-1/user-token/issue", "/open/user-chats/chat-1/close", "/open/channel?other=1", "/open/channel#fragment", "/open/users/%2e%2e", "/open/users/a%2fb", "/open/users/a%5cb", "/open/users/%252e%252e", "/open/users/%ZZ", "/open/channel/"])
        await assert.rejects(request(input({ path })), error => error instanceof ChannelSourceHttpError && ["request", "version"].includes(error.code));
    await assert.rejects(request(input({ method: "POST" as "GET" })), code("request"));
    assert.equal(calls, 0);
});
test("버전 누락/변경/중복 및 호출자 auth/Host 헤더 주입은 거절", async () => {
    let calls = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { calls++; return json(); } });
    const cases: Record<string, string>[] = [{}, { "Channel-Version": "v5" }, { "Channel-Version": CHANNEL_SOURCE_VERSION, "channel-version": CHANNEL_SOURCE_VERSION }, { "Channel-Version": CHANNEL_SOURCE_VERSION, "x-access-key": "injected" }, { "Channel-Version": CHANNEL_SOURCE_VERSION, Host: "foreign.example.test" }];
    for (const headers of cases)
        await assert.rejects(request(input({ headers })), code("version"));
    assert.equal(calls, 0);
});
test("실 fetch의 임의 base 거절, 명시적 가상 fetch만 다른 origin 허용", async () => {
    for (const baseUrl of ["https://other.example.test", "http://127.0.0.1:1", "https://user:secret@api.channel.io", "https://api.channel.io/open", "https://api.channel.io?key=secret"])
        assert.throws(() => createChannelSourceRequest({ ...credentials, baseUrl }), code("configuration", ["secret"]));
    assert.throws(() => createChannelSourceRequest({ ...credentials, baseUrl: "https://other.example.test", fetch: globalThis.fetch }), code("configuration"));
    let origin = "";
    const request = createChannelSourceRequest({ ...credentials, baseUrl: "https://channel.example.test", fetch: async (url) => { origin = new URL(String(url)).origin; return json(); } });
    await request(input());
    assert.equal(origin, "https://channel.example.test");
});
test("잘못된 인증값·응답 크기·timeout·쿼리 타입은 입력을 노출하지 않고 거절", async () => {
    for (const accessSecret of ["", " secret ", "secret\r\nHost:foreign", "\u0000secret"])
        assert.throws(() => createChannelSourceRequest({ ...credentials, accessSecret }), code("configuration", ["secret", "foreign"]));
    assert.throws(() => createChannelSourceRequest({ ...credentials, maxResponseBytes: 0 }), code("configuration"));
    let calls = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { calls++; return json(); } });
    for (const timeoutMs of [0, NaN, Infinity, 120001, 1.5])
        await assert.rejects(request(input({ timeoutMs })), code("request"));
    await assert.rejects(request(input({ query: { limit: NaN } })), code("request"));
    await assert.rejects(request(input({ query: { key: ["bad"] as unknown as string } })), code("request"));
    assert.equal(calls, 0);
});
test("응답 버전 불일치 또는 성공 응답의 버전 누락은 본문 소비 없이 거절", async () => {
    for (const version of ["2025-01-01", null]) {
        let cancelled = false;
        const request = createChannelSourceRequest({ ...credentials, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: version ? { "Channel-Version": version } : {} }) });
        await assert.rejects(request(input()), code("version"));
        assert.equal(cancelled, true);
    }
});
test("4xx/429/5xx JSON 상태·본문과 rate-limit 헤더를 collector에 그대로 반환", async () => {
    for (const status of [400,401,403,404,410,429,500,503]) {
        const body = { code: "fictional-upstream-error", message: "source error body" };
        const request = createChannelSourceRequest({ ...credentials, fetch: async () => json(body, status, { "Retry-After": "3", "x-ratelimit-scope": "channel", "Set-Cookie": "not-for-collector=secret", "x-access-secret": "not-for-collector" }) });
        const result = await request(input());
        assert.equal(result.status, status);
        assert.deepEqual(result.body, body);
        assert.equal(result.headers["retry-after"], "3");
        assert.equal(result.headers["x-ratelimit-scope"], "channel");
        assert.equal(result.headers["set-cookie"], undefined);
        assert.equal(result.headers["x-access-secret"], undefined);
    }
});
test("버전 없는 HTTP 오류도 collector 상태를 보존하고 text 오류 본문은 제한 안에서 반환", async () => {
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => new Response("fictional provider outage", { status: 503 }) });
    const result = await request(input());
    assert.equal(result.status, 503);
    assert.equal(result.body, "fictional provider outage");
});
test("성공 응답의 잘못된 JSON/UTF8은 원문 없이 형식 오류", async () => {
    for (const body of ["upstream-secret-body", new Uint8Array([0xff,0xff])]) {
        const request = createChannelSourceRequest({ ...credentials, fetch: async () => new Response(body, { headers: { "Channel-Version": CHANNEL_SOURCE_VERSION } }) });
        await assert.rejects(request(input()), code("json", ["upstream-secret-body", credentials.accessSecret]));
    }
});
test("선언된 큰 응답과 stream 누적 byte 초과는 읽기를 취소", async () => {
    for (const declared of [true, false]) {
        let cancelled = false, pulls = 0;
        const request = createChannelSourceRequest({ ...credentials, maxResponseBytes: 32, fetch: async () => new Response(new ReadableStream({
            pull(controller) { pulls++; controller.enqueue(new Uint8Array(24)); }, cancel() { cancelled = true; },
        }), { headers: { "Channel-Version": CHANNEL_SOURCE_VERSION, ...(declared ? { "Content-Length": "1000" } : {}) } }) });
        await assert.rejects(request(input()), code("too_large"));
        assert.equal(cancelled, true);
        assert.ok(pulls <= 4);
    }
});
test("응답 제한은 문자열 길이 대신 UTF8 byte 길이로 판단", async () => {
    const text = JSON.stringify({ value: "가나다라마바사" });
    assert.ok(Buffer.byteLength(text) > text.length);
    const request = createChannelSourceRequest({ ...credentials, maxResponseBytes: text.length, fetch: async () => new Response(text, { headers: { "Channel-Version": CHANNEL_SOURCE_VERSION } }) });
    await assert.rejects(request(input()), code("too_large"));
});
test("fetch가 AbortSignal을 무시해도 정해진 시간이 지나면 종료", async () => {
    let signal: AbortSignal | undefined;
    const request = createChannelSourceRequest({ ...credentials, fetch: (_url, init) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}); } });
    const started = Date.now();
    await assert.rejects(request(input({ timeoutMs: 15 })), code("timeout"));
    assert.equal(signal?.aborted, true);
    assert.ok(Date.now() - started < 1000);
});
test("응답 본문이 멈춰도 deadline을 적용하고 reader 취소", async () => {
    let cancelled = false;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Channel-Version": CHANNEL_SOURCE_VERSION } }) });
    await assert.rejects(request(input({ timeoutMs: 15 })), code("timeout"));
    assert.equal(cancelled, true);
});
test("연속 작업이 timer 실행을 늦춰도 경과한 deadline의 응답은 성공 처리하지 않음", async (t) => {
    let now = 1000;
    t.mock.method(Date, "now", () => now);
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => {
        now += 50;
        return json();
    } });
    await assert.rejects(request(input({ timeoutMs: 10 })), code("timeout"));
});
test("요청 전/진행 중 외부 abort를 존중하며 reason에 든 인증값은 숨김", async () => {
    const controller = new AbortController();
    let calls = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { calls++; return new Promise<Response>(() => {}); } });
    const pending = request(input({ signal: controller.signal }));
    controller.abort(credentials.accessSecret);
    await assert.rejects(pending, code("aborted", [credentials.accessSecret]));
    await assert.rejects(request(input({ signal: controller.signal })), code("aborted", [credentials.accessSecret]));
    assert.equal(calls, 1);
});
test("네트워크 예외의 URL·파일 key·키·본문·cause를 외부 오류에 전달하지 않음", async () => {
    const secret = [credentials.accessKey, credentials.accessSecret, "private-file-key", "private-body"];
    const request = createChannelSourceRequest({ ...credentials, fetch: async () => { throw new Error(secret.join(" ")); } });
    await assert.rejects(request(input({ query: { key: secret[2] } })), code("network", secret));
});
test("redirect 응답/이미 이동한 응답/다른 host 결과는 주소를 노출하지 않고 거절", async () => {
    for (const kind of ["status", "redirected", "foreign"]) {
        const request = createChannelSourceRequest({ ...credentials, fetch: async () => {
            if (kind === "status") return new Response(null, { status: 302, headers: { Location: "https://foreign.example.test/?key=private" } });
            const response = json();
            Object.defineProperty(response, kind === "redirected" ? "redirected" : "url", { value: kind === "redirected" ? true : "https://foreign.example.test/?key=private" });
            return response;
        }});
        await assert.rejects(request(input()), code("redirect", ["foreign.example.test", "private", credentials.accessSecret]));
    }
});
