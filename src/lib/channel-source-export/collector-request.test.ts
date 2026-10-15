import assert from "node:assert/strict";
import { test } from "node:test";
import { exportChannelData, type ChannelExportOptions } from "@/lib/customer-imports/channel-export";
import { createChannelSourceRequest, ChannelSourceHttpError } from "./http";
import { createChannelCollectorRequest, ChannelSourceArchiveError, type ChannelSourcePage } from "./collector-request";

const channelId = "fictional-collector-http";
const credentials = { accessKey: "fictional-key", accessSecret: "fictional-secret" };
const json = (body: unknown, status = 200, version = "2026-06-01") =>
    new Response(JSON.stringify(body), { status, headers: { "Channel-Version": version } });
const fetchStub = (handler: (url: URL, init?: RequestInit) => Promise<Response>): typeof fetch =>
    async (input, init) => handler(new URL(typeof input === "string" || input instanceof URL ? input : input.url), init);
function emptyPage(url: URL) {
    if (url.pathname === "/open/channel") return json({ channel: { id: channelId }, sourceExtra: "preserve raw channel" });
    if (url.pathname === "/open/managers") return json({ managers: [], nextCursor: null, hasNext: false });
    assert.equal(url.pathname, "/open/user-chats");
    return json({ userChats: [], sessions: [{ id: "fictional-session" }], chatTags: [{ id: "fictional-tag" }], nextCursor: null, hasNext: false });
}
function collect(request: ChannelExportOptions["request"], overrides: Partial<ChannelExportOptions> = {}) {
    return exportChannelData({ channelId, request, sleep: async () => {}, limits: { minRequestIntervalMs: 0, retryBaseMs: 0, retryMaxMs: 0, maxAttempts: 2 }, ...overrides });
}

test("actual HTTP adapter network failure retries through the collector and archives full side-loaded fields", async () => {
    let calls = 0;
    const pages: ChannelSourcePage[] = [];
    const request = createChannelSourceRequest({ ...credentials, fetch: fetchStub(async (url, init) => {
        calls++;
        assert.equal(new Headers(init?.headers).get("x-access-secret"), credentials.accessSecret);
        if (calls === 1) throw new Error("fictional provider network error");
        return emptyPage(url);
    }) });
    const result = await collect(createChannelCollectorRequest(request, { expectedChannelId: channelId, savePage: async page => { pages.push(page); } }));
    assert.equal(result.status, "complete");
    assert.equal(calls, 9);
    assert.equal(result.checkpoint.requestCount, 9);
    assert.equal(pages.length, 8);
    const page = pages.find(value => value.path === "/open/user-chats")!;
    assert.deepEqual((page.body as Record<string, unknown>).sessions, [{ id: "fictional-session" }]);
    assert.deepEqual((page.body as Record<string, unknown>).chatTags, [{ id: "fictional-tag" }]);
    assert.equal(JSON.stringify(pages).includes(credentials.accessSecret), false);
    assert.equal(JSON.stringify(pages).includes("x-access-key"), false);
});

test("typed HTTP timeout retries but JSON/version/size failures and authentication stop once", async () => {
    for (const failure of ["timeout", "json", "version", "size", "auth"] as const) {
        let calls = 0;
        const transport = createChannelSourceRequest({ ...credentials, maxResponseBytes: failure === "size" ? 1 : undefined, fetch: fetchStub(async url => {
            calls++;
            if (failure === "timeout" && calls === 1)
                throw new ChannelSourceHttpError("fictional timeout", "timeout");
            if (failure === "json") return new Response("invalid", { headers: { "Channel-Version": "2026-06-01" } });
            if (failure === "version") return json({}, 200, "2025-01-01");
            if (failure === "auth") return json({ message: "fictional auth" }, 401);
            return emptyPage(url);
        }) });
        const result = await collect(createChannelCollectorRequest(transport));
        assert.equal(result.status, failure === "timeout" ? "complete" : "failed");
        assert.equal(calls, failure === "timeout" ? 9 : 1);
        if (failure === "auth") assert.equal(result.checkpoint.failure?.code, "authentication_failed");
    }
});

test("raw archive failure leaves the source page uncommitted and returns no secret-bearing storage error", async () => {
    let chatCalls = 0;
    const request = createChannelSourceRequest({ ...credentials, fetch: fetchStub(async url => {
        if (url.pathname === "/open/user-chats") chatCalls++;
        return emptyPage(url);
    }) });
    const result = await collect(createChannelCollectorRequest(request, { expectedChannelId: channelId, savePage: async page => {
        if (page.path === "/open/user-chats") throw new Error(credentials.accessSecret);
    } }));
    assert.equal(result.status, "failed");
    assert.equal(chatCalls, 1);
    assert.equal(result.checkpoint.ledger["chats:opened"].pages, 0);
    assert.deepEqual(result.bundle.userChats, []);
    assert.equal(result.bundle.hasNext, true);
    assert.equal(JSON.stringify(result).includes(credentials.accessSecret), false);
});

test("archive callback receives an isolated body and signed file URL responses are never page-archived", async () => {
    const pages: ChannelSourcePage[] = [];
    const request = createChannelCollectorRequest(createChannelSourceRequest({ ...credentials, fetch: fetchStub(async url =>
        url.pathname.endsWith("/messages/file") ? json({ result: "https://files.example.test/signed?key=fictional" }) : emptyPage(url)) }), {
        expectedChannelId: channelId,
        savePage: async page => {
            pages.push(page);
            (page.body as Record<string, unknown>).changedByArchive = true;
        },
    });
    const common = { method: "GET" as const, headers: { "Channel-Version": "2026-06-01" as const }, query: {}, timeoutMs: 1000, signal: new AbortController().signal };
    const source = await request({ ...common, path: "/open/channel" });
    assert.equal((source.body as Record<string, unknown>).changedByArchive, undefined);
    const file = await request({ ...common, path: "/open/user-chats/fictional/messages/file", query: { key: "fictional" } });
    assert.equal((file.body as Record<string, unknown>).result, "https://files.example.test/signed?key=fictional");
    assert.equal(pages.length, 1);
});

test("storage exceptions are wrapped without their message, cause, URL or keys", async () => {
    const request = createChannelCollectorRequest(createChannelSourceRequest({ ...credentials, fetch: fetchStub(async url => emptyPage(url)) }), { expectedChannelId: channelId, savePage: async () => { throw new Error("https://private.example.test/" + credentials.accessSecret); } });
    await assert.rejects(request({ method: "GET", path: "/open/channel", query: {}, headers: { "Channel-Version": "2026-06-01" }, timeoutMs: 1000, signal: new AbortController().signal }), error => {
        assert.ok(error instanceof ChannelSourceArchiveError);
        assert.equal(error.code, "archive");
        assert.equal(JSON.stringify(error).includes(credentials.accessSecret), false);
        assert.equal(error.message.includes("private.example.test"), false);
        assert.equal(error.cause, undefined);
        return true;
    });
});

test("mismatched channel probes are rejected by the core without archiving foreign profiles, including resume", async () => {
    const completed = await collect(createChannelCollectorRequest(createChannelSourceRequest({ ...credentials, fetch: fetchStub(async url => emptyPage(url)) })));
    assert.equal(completed.status, "complete");
    for (const resume of [undefined, completed.checkpoint]) {
        const pages: ChannelSourcePage[] = [];
        let calls = 0;
        const request = createChannelSourceRequest({ ...credentials, fetch: fetchStub(async () => {
            calls++;
            return json({ channel: { id: "foreign-channel", profile: "foreign-private-profile" } });
        }) });
        const result = await collect(createChannelCollectorRequest(request, {
            expectedChannelId: channelId, savePage: async page => { pages.push(page); },
        }), { resume });
        assert.equal(result.status, "failed");
        assert.equal(result.checkpoint.failure?.code, "channel_mismatch");
        assert.equal(calls, 1);
        assert.deepEqual(pages, []);
        assert.equal(JSON.stringify(result).includes("foreign-private-profile"), false);
    }
});

test("archiving requires an explicit expected channel scope", () => {
    const request = createChannelSourceRequest({ ...credentials, fetch: fetchStub(async url => emptyPage(url)) });
    assert.throws(() => createChannelCollectorRequest(request, { savePage: async () => {} }), ChannelSourceArchiveError);
});
