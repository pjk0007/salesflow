import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxRequest, InboxRequestError } from "./index";
import { StaffDraftSession } from "../hooks/staff-draft-session";
import { configureMessengerApiOrigin } from "@/components/customer-messenger/api-origin";

test("deadline wrapper preserves widget origin isolation and staff request routing", async () => {
    const original = global.fetch;
    const requests: { url: unknown; options?: RequestInit }[] = [];
    global.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ success: true, data: { id: 1 } }));
    };
    try {
        configureMessengerApiOrigin("https://messenger.example.test");
        const path = `/api/messenger/${"a".repeat(48)}/messages`;
        await inboxRequest(path, { credentials: "include", redirect: "follow" });
        await inboxRequest("/api/inbox", { credentials: "same-origin" });
        assert.equal(requests[0].url, `https://messenger.example.test${path}`);
        assert.equal(requests[0].options?.credentials, "omit");
        assert.equal(requests[0].options?.redirect, "error");
        assert.ok(requests[0].options?.signal instanceof AbortSignal);
        assert.equal(requests[1].url, "/api/inbox");
        assert.equal(requests[1].options?.credentials, "same-origin");
    } finally { configureMessengerApiOrigin(); global.fetch = original; }
});

test("inbox deadline covers stalled headers and stalled JSON bodies", async () => {
    const original = global.fetch;
    try {
        for (const phase of ["headers", "body"]) {
            let signal: AbortSignal | undefined;
            global.fetch = async (_url, options) => {
                signal = options?.signal as AbortSignal;
                if (phase === "headers") return new Promise<Response>(() => {});
                return { ok: true, json: () => new Promise(() => {}) } as Response;
            };
            await assert.rejects(inboxRequest("http://fixture.invalid/inbox", undefined, 20),
                error => error instanceof InboxRequestError && error.status === 408);
            assert.equal(signal?.aborted, true);
        }
    } finally { global.fetch = original; }
});

test("an uncertain send preserves draft and idempotency identity; no automatic POST retry", async () => {
    const original = global.fetch;
    const session = new StaffDraftSession();
    session.setText("a:reply", "가상 답변");
    const operation = session.begin("a:reply", "same-body")!;
    let requests = 0;
    global.fetch = async () => { requests++; return new Promise<Response>(() => {}); };
    try {
        await assert.rejects(inboxRequest("http://fixture.invalid/inbox/a", {
            method: "POST", signal: operation.signal, body: JSON.stringify({clientId:operation.clientId}),
        }, 20), /전송 여부/);
        operation.finish();
        assert.equal(session.getSnapshot().text["a:reply"], "가상 답변");
        assert.equal(session.getSnapshot().pending["a:reply"]?.busy, false);
        assert.equal(session.begin("a:reply", "same-body")!.clientId, operation.clientId);
        assert.equal(requests, 1);
    } finally { global.fetch = original; }
});

test("session cancellation still aborts a pending inbox request", async () => {
    const original = global.fetch;
    const controller = new AbortController();
    global.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {once:true});
    });
    try {
        const pending = inboxRequest("http://fixture.invalid/inbox", {signal:controller.signal}, 1000);
        controller.abort(new DOMException("session changed", "AbortError"));
        await assert.rejects(pending, {name:"AbortError"});
    } finally { global.fetch = original; }
});

test("auth errors retain their status; successful data is unchanged", async () => {
    const original = global.fetch;
    try {
        global.fetch = async () => new Response(JSON.stringify({success:false,error:"로그인 필요"}), {status:401});
        await assert.rejects(inboxRequest("http://fixture.invalid/inbox"), error => error instanceof InboxRequestError && error.status === 401);
        global.fetch = async () => new Response(JSON.stringify({success:true,data:{id:1}}));
        assert.deepEqual(await inboxRequest("http://fixture.invalid/inbox"), {id:1});
    } finally { global.fetch = original; }
});

test("상담 네트워크·비JSON 오류는 한국어이며 전송 초안 보존을 안내한다", async () => {
    const original = global.fetch;
    try {
        for (const method of ["GET", "POST"]) {
            global.fetch = async () => { throw new TypeError("Failed to fetch"); };
            await assert.rejects(inboxRequest("/api/inbox", { method }), cause =>
                cause instanceof InboxRequestError && cause.status === 0 && /[가-힣]/.test(cause.message) &&
                (method === "GET" || cause.message.includes("초안은 유지됩니다")));
            global.fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
            await assert.rejects(inboxRequest("/api/inbox", { method }), cause =>
                cause instanceof InboxRequestError && cause.status === 502 && cause.message.includes("서버 응답") &&
                (method === "GET" || cause.message.includes("초안은 유지됩니다")));
        }
    } finally { global.fetch = original; }
});

test("a file upload survives the text deadline and still has a bounded deadline", async (t) => {
    const original = global.fetch;
    t.mock.timers.enable({apis:["setTimeout"]});
    let signal: AbortSignal | undefined;
    global.fetch = async (_url, options) => {
        signal = options?.signal as AbortSignal;
        assert.equal(new Headers(options?.headers).has("Content-Type"), false);
        return new Promise<Response>(() => {});
    };
    try {
        const form = new FormData();
        form.set("file", new File(["synthetic"], "qa.txt"));
        const result = inboxRequest("http://fixture.invalid/attachments", {method:"POST",body:form}).then(
            () => "unexpected success", error => error,
        );
        t.mock.timers.tick(15001);
        assert.equal(signal?.aborted, false);
        t.mock.timers.tick(120000);
        assert.ok(await result instanceof InboxRequestError);
        assert.equal(signal?.aborted, true);
    } finally { global.fetch = original; t.mock.timers.reset(); }
});
