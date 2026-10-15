import { test } from "node:test";
import assert from "node:assert/strict";
import {
    exportChannelData, CHANNEL_EXPORT_VERSION, ChannelExportTransportError,
    type ChannelExportOptions, type ChannelExportRequest, type ChannelExportResponse,
    type ChannelExportCheckpoint, type ChannelRawEntity,
} from "./channel-export";

const channelId = "channel-fixture";
const raw = <T extends ChannelRawEntity>(value: T) => ({ channelId, ...value });
const users = [
    raw({ id: "u-anon", type: "lead", member: false, memberId: "veil-1", veilId: "veil-1", profile: { name: "가상 익명" }, createdAt: "2024-01-01T01:02:03Z" }),
    raw({ id: "u-member", type: "member", member: true, memberId: "member-1", profile: { name: "가상 회원", email: "fixture@example.test" }, createdAt: "2024-01-01T01:02:03Z" }),
];
const manager = raw({ id: "manager-1", name: "가상 담당자", removed: false });
const bot = raw({ id: "bot-1", name: "가상 봇" });
// Oracle source IDs are independent of the collector's state enumeration and counters.
const chats = [
    raw({ id: "chat-open", state: "opened", userId: "u-anon", managed: true, title: "원본 제목", name: "Main" }),
    raw({ id: "chat-closed", state: "closed", userId: "u-member", managed: true }),
    raw({ id: "chat-snoozed", state: "snoozed", userId: "u-member", managed: true }),
    raw({ id: "chat-queued", state: "queued", userId: "u-member", managed: true }),
    raw({ id: "chat-initial", state: "initial", userId: "u-anon", managed: false }),
    raw({ id: "chat-missed", state: "missed", userId: "u-member", managed: true }),
];
const messages = chats.flatMap(chat => [
    raw({ id: `${chat.id}-first`, chatId: chat.id, chatType: "userChat", personType: "user", personId: chat.userId, plainText: "가상 문의", createdAt: "2024-01-01T01:02:03Z" }),
    raw({ id: `${chat.id}-note`, chatId: chat.id, chatType: "userChat", personType: "manager", personId: "manager-1", plainText: "가상 비공개 메모", options: ["private"], files: [{ id: `file-${chat.id}`, name: "가상.pdf", key: `private/${chat.id}`, size: 123, contentType: "application/pdf" }], createdAt: "2024-01-01T01:02:04Z" }),
]);
const page = (data: Record<string, unknown>, nextCursor: string | null = null): ChannelExportResponse => ({ status: 200, body: { ...data, hasNext: nextCursor !== null, nextCursor } });
function fixture() {
    const calls: ChannelExportRequest[] = [], waits: number[] = [], saved: ChannelExportCheckpoint[] = [];
    async function request(req: ChannelExportRequest): Promise<ChannelExportResponse> {
        calls.push(structuredClone({ ...req, signal: undefined }) as unknown as ChannelExportRequest);
        assert.equal(req.method, "GET");
        assert.deepEqual(req.headers, { "Channel-Version": "2026-06-01" });
        assert(req.signal instanceof AbortSignal);
        const cursor = req.query.cursor;
        if (req.path === "/open/channel") return { status: 200, body: { channel: { id: channelId } } };
        if (req.path === "/open/managers") {
            assert.deepEqual(req.query, { limit: 100, ...(cursor ? { cursor } : {}) });
            if (!cursor) return page({ managers: [manager] }, "opaque+/=manager-2");
            assert.equal(cursor, "opaque+/=manager-2");
            return page({ managers: [{ name: manager.name, removed: false, id: manager.id, channelId }] });
        }
        if (req.path === "/open/user-chats") {
            assert.equal(req.query.dateTimeFieldName, "deskUpdatedAt");
            assert.equal(req.query.sortOrder, "asc");
            const chat = chats.find(c => c.state === req.query.state);
            assert(chat, `unexpected state ${req.query.state}`);
            if (cursor) assert.equal(cursor, "opaque+/=chat-open-2");
            return page({ userChats: [chat], users, managers: [manager], messages: messages.filter(m => m.chatId === chat.id).slice(-1) }, chat.id === "chat-open" && !cursor ? "opaque+/=chat-open-2" : null);
        }
        const match = req.path.match(/^\/open\/user-chats\/([^/]+)\/messages$/);
        if (match) {
            const list = messages.filter(m => m.chatId === decodeURIComponent(match[1]));
            assert.equal(req.query.sortOrder, "asc");
            if (!cursor) return page({ messages: [list[0]], bots: [bot] }, "opaque+/=message-2");
            assert.equal(cursor, "opaque+/=message-2");
            return page({ messages: [list[0], list[1]], bots: [bot] });
        }
        const userMatch = req.path.match(/^\/open\/users\/([^/]+)$/);
        if (userMatch) {
            const user = users.find(u => u.id === decodeURIComponent(userMatch[1]));
            assert(user);
            return { status: 200, body: { user } };
        }
        assert.fail(`unexpected endpoint ${req.path}`);
    }
    const options: ChannelExportOptions = {
        channelId, request, sleep: async ms => { waits.push(ms); },
        checkpoint: async state => { saved.push(structuredClone(state)); },
        limits: { minRequestIntervalMs: 0, retryBaseMs: 10 }, now: () => 1_000_000,
    };
    return { options, calls, waits, saved, request };
}
function assertOracle(result: Awaited<ReturnType<typeof exportChannelData>>) {
    assert.equal(result.status, "complete");
    assert.equal(result.bundle.hasNext, false);
    assert.deepEqual(result.bundle.userChats.map(c => c.id).sort(), ["chat-closed", "chat-initial", "chat-missed", "chat-open", "chat-queued", "chat-snoozed"]);
    assert.deepEqual(result.bundle.messages.map(m => m.id).sort(), messages.map(m => m.id).sort());
    assert.equal(new Set(result.bundle.messages.map(m => `${m.chatId}/${m.id}`)).size, 12);
    assert.deepEqual(result.bundle.users, users);
    assert.deepEqual(result.bundle.userChats, chats);
    for (const message of messages) assert.deepEqual(result.bundle.messages.find(m => m.id === message.id), message);
    assert.deepEqual(result.counts, { users: 2, managers: 1, userChats: 6, messages: 12, bots: 1, attachments: 6 });
    assert(Object.values(result.checkpoint.ledger).every(entry => entry.status === "complete"));
}
test("all six official states, opaque cursors, full chat messages and raw/private/file/user relationships", async () => {
    const f = fixture(), result = await exportChannelData(f.options);
    assertOracle(result);
    assert.equal(result.checkpoint.apiVersion, CHANNEL_EXPORT_VERSION);
    assert.equal(f.calls.filter(c => c.path === "/open/users").length, 0);
    assert.equal(f.calls.filter(c => c.path.startsWith("/open/users/")).length, 2);
    assert(!f.calls.some(c => c.path.endsWith("/file")));
    assert.deepEqual(result.bundle.managers, [manager]);
    assert.deepEqual(result.bundle.bots, [bot]);
});
test("checkpoint resume after every request boundary matches independent full ID oracle", async () => {
    const uninterrupted = fixture();
    assertOracle(await exportChannelData(uninterrupted.options));
    for (let boundary = 1; boundary < uninterrupted.calls.length; boundary++) {
        const first = fixture();
        first.options.limits = { ...first.options.limits, maxRequests: boundary };
        const partial = await exportChannelData(first.options);
        assert.equal(partial.status, "incomplete");
        assert.equal(partial.bundle.hasNext, true);
        const next = fixture();
        const result = await exportChannelData({ ...next.options, resume: partial.checkpoint });
        assertOracle(result);
        assert.equal(next.calls[0].path, "/open/channel");
        const completed = new Set(Object.values(partial.checkpoint.ledger).filter(e => e.status === "complete").map(e => e.path));
        assert(!next.calls.slice(1).some(call => completed.has(call.path) && call.path !== "/open/user-chats"));
    }
});
test("every run verifies credential channel, including a completed checkpoint resumed with another key", async () => {
    const original = fixture(), finished = await exportChannelData(original.options);
    assertOracle(finished);
    for (const resume of [undefined, finished.checkpoint]) {
        const f = fixture();
        let calls = 0;
        const result = await exportChannelData({ ...f.options, resume, request: async req => {
            calls++; assert.equal(req.path, "/open/channel");
            return { status: 200, body: { channel: { id: "wrong-channel" } } };
        } });
        assert.equal(calls, 1); assert.equal(result.status, "failed");
        assert.equal(result.checkpoint.failure?.code, "channel_mismatch");
        assert.equal(result.bundle.hasNext, true);
        assert.deepEqual(result.bundle.messages, resume?.bundle.messages ?? []);
    }
});
test("same ID different content rejects the entire page without advancing or committing its prefix", async () => {
    const f = fixture();
    const result = await exportChannelData({ ...f.options, request: async req => {
        if (req.path === "/open/managers" && req.query.cursor) return page({ managers: [raw({ id: "should-not-commit" }), { ...manager, name: "충돌" }] });
        return f.request(req);
    } });
    assert.equal(result.status, "failed");
    assert.equal(result.checkpoint.failure?.code, "conflicting_managers_id");
    assert.deepEqual(result.bundle.managers, [manager]);
    assert.equal(result.checkpoint.ledger.managers.cursor, "opaque+/=manager-2");
    assert.equal(result.checkpoint.ledger.managers.pages, 1);
    const resumed = fixture();
    assertOracle(await exportChannelData({ ...resumed.options, resume: result.checkpoint }));
});
test("cursor loops and inconsistent completion markers fail before page commit", async () => {
    for (const pagination of [
        { hasNext: true, nextCursor: "opaque+/=manager-2" },
        { hasNext: true, nextCursor: null },
        { hasNext: false, nextCursor: "unexpected" },
        { nextCursor: null },
    ]) {
        const f = fixture();
        const result = await exportChannelData({ ...f.options, request: req => req.path === "/open/managers" && req.query.cursor
            ? Promise.resolve({ status: 200, body: { managers: [], ...pagination } }) : f.request(req) });
        assert.equal(result.status, "failed");
        assert(["cursor_loop", "invalid_pagination"].includes(result.checkpoint.failure!.code));
        assert.equal(result.checkpoint.ledger.managers.pages, 1);
    }
});
test("429 Retry-After, transient 503 and typed timeout retry with finite attempts", async () => {
    for (const mode of ["429", "503", "timeout"] as const) {
        const f = fixture(); let attempts = 0;
        const result = await exportChannelData({ ...f.options, request: async req => {
            if (req.path === "/open/managers" && !req.query.cursor && attempts++ === 0) {
                if (mode === "timeout") throw new ChannelExportTransportError("timeout");
                return { status: Number(mode), headers: mode === "429" ? { "Retry-After": "2" } : {} };
            }
            return f.request(req);
        } });
        assertOracle(result);
        assert(f.waits.includes(mode === "429" ? 2000 : 10));
    }
    const f = fixture(); let requests = 0;
    const result = await exportChannelData({ ...f.options, request: async () => { requests++; return { status: 503 }; } });
    assert.equal(result.status, "failed"); assert.equal(requests, 3);
    assert.equal(result.checkpoint.failure?.code, "retries_exhausted");
});
test("hung transport is timed out, aborted and retried only to the configured limit", async () => {
    const f = fixture(), signals: AbortSignal[] = [];
    const result = await exportChannelData({ ...f.options, limits: { ...f.options.limits, timeoutMs: 5, maxAttempts: 2 }, request: req => {
        signals.push(req.signal); return new Promise(() => {});
    } });
    assert.equal(result.status, "failed"); assert.equal(result.checkpoint.failure?.code, "timeout");
    assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
});
test("deadline retries a fetch-like transport that rejects synchronously when aborted", async () => {
    const f = fixture(); let attempts = 0;
    const result = await exportChannelData({ ...f.options, limits: { ...f.options.limits, timeoutMs: 5, maxAttempts: 2 }, request: req => {
        attempts++;
        return new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    } });
    assert.equal(result.checkpoint.failure?.code, "timeout"); assert.equal(attempts, 2);
});
test("external abort cancels a pending request immediately without timeout retries", async () => {
    const f = fixture(), controller = new AbortController(); let attempts = 0;
    const result = await exportChannelData({ ...f.options, signal: controller.signal, request: req => {
        attempts++;
        return new Promise((_, reject) => {
            req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
            controller.abort();
        });
    } });
    assert.equal(result.status, "aborted"); assert.equal(attempts, 1); assert.equal(f.waits.length, 0);
});
test("rate reset headers are respected and excessive retry waits stop without early retry", async () => {
    const f = fixture(); let calls = 0;
    const result = await exportChannelData({ ...f.options, request: async req => {
        if (calls++ === 0) return { status: 429, headers: { "X-RateLimit-Reset": "1003" } };
        return f.request(req);
    } });
    assertOracle(result); assert.equal(f.waits[0], 3000);
    const capped = fixture(); let cappedCalls = 0;
    const failed = await exportChannelData({ ...capped.options, request: async () => {
        cappedCalls++; return { status: 429, headers: { "retry-after": "99999" } };
    } });
    assert.equal(failed.checkpoint.failure?.code, "retry_delay_limit"); assert.equal(cappedCalls, 1); assert.equal(capped.waits.length, 0);
});
test("authentication and nontransient errors stop immediately without leaking server payloads", async () => {
    for (const status of [401, 403, 400, 404]) {
        const f = fixture(); let calls = 0;
        const result = await exportChannelData({ ...f.options, request: async () => { calls++; return { status, body: { secret: "DO-NOT-PERSIST" } }; } });
        assert.equal(calls, 1); assert.equal(result.status, "failed"); assert.equal(f.waits.length, 0);
        assert.equal(result.checkpoint.failure?.status, status);
        assert(!JSON.stringify(result).includes("DO-NOT-PERSIST"));
    }
});
test("abort after a committed page resumes its next cursor with no lost IDs", async () => {
    const f = fixture(), controller = new AbortController();
    const result = await exportChannelData({ ...f.options, signal: controller.signal, checkpoint: async checkpoint => {
        await f.options.checkpoint!(checkpoint);
        if (checkpoint.ledger["messages:chat-open"]?.pages === 1) controller.abort();
    } });
    assert.equal(result.status, "aborted");
    assert.equal(result.checkpoint.ledger["messages:chat-open"].cursor, "opaque+/=message-2");
    const resumed = fixture();
    assertOracle(await exportChannelData({ ...resumed.options, resume: result.checkpoint }));
});
test("checkpoint persistence failure stops immediately; last durable snapshot replays safely", async () => {
    const f = fixture(); let durable: ChannelExportCheckpoint | undefined;
    const result = await exportChannelData({ ...f.options, checkpoint: async state => {
        if (state.ledger["messages:chat-open"]?.pages === 1) throw new Error("disk unavailable");
        durable = structuredClone(state);
    } });
    assert.equal(result.checkpoint.failure?.code, "checkpoint_failed");
    assert.equal(result.status, "failed");
    assert(durable); assert.equal(durable.ledger["messages:chat-open"].pages, 0);
    const resumed = fixture(); assertOracle(await exportChannelData({ ...resumed.options, resume: durable }));
});
test("entity/page limits yield an explicitly incomplete bundle, and limits cannot exceed hard ceilings", async () => {
    for (const limits of [{ maxEntities: 1 }, { maxPagesPerEndpoint: 1 }]) {
        const f = fixture(), result = await exportChannelData({ ...f.options, limits: { ...f.options.limits, ...limits } });
        assert.equal(result.status, "incomplete"); assert.equal(result.bundle.hasNext, true);
    }
    for (const limits of [{ pageSize: 501 }, { maxAttempts: 6 }, { maxRequests: 100001 }, { timeoutMs: 0 }]) {
        const f = fixture(); await assert.rejects(exportChannelData({ ...f.options, limits })); assert.equal(f.calls.length, 0);
    }
});
test("resume rejects another channel, version, page size or a forged endpoint before any request", async () => {
    const f = fixture(), completed = await exportChannelData(f.options);
    for (const mutation of [
        (s: ChannelExportCheckpoint) => { s.channelId = "another"; },
        (s: ChannelExportCheckpoint) => { s.schemaVersion = 2 as 1; },
        (s: ChannelExportCheckpoint) => { s.ledger.managers.path = "/open/users"; },
        (s: ChannelExportCheckpoint) => { s.ledger.managers.seenCursors[0] = "missing-initial-page"; },
        (s: ChannelExportCheckpoint) => { s.bundle.hasNext = "invalid" as unknown as boolean; },
        (s: ChannelExportCheckpoint) => { s.status = "unknown" as ChannelExportCheckpoint["status"]; },
    ]) {
        const resume = structuredClone(completed.checkpoint); mutation(resume);
        const next = fixture(); await assert.rejects(exportChannelData({ ...next.options, resume })); assert.equal(next.calls.length, 0);
    }
    await assert.rejects(exportChannelData({ ...f.options, resume: completed.checkpoint, limits: { pageSize: 200 } }));
});
