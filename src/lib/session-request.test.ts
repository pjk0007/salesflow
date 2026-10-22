import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSessionResponse } from "./session-request";

test("a stalled authentication request is aborted instead of loading forever", async () => {
    const stalled: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    await assert.rejects(fetchSessionResponse(stalled, 10), /aborted/);
});

test("only an explicit 401 clears authentication", async () => {
    assert.deepEqual(await fetchSessionResponse(async () => new Response("", { status: 401 })), { success: false });
    await assert.rejects(fetchSessionResponse(async () => new Response("", { status: 503 })), /session_unavailable/);
    await assert.rejects(fetchSessionResponse(async () => Response.json({ success: false })), /session_invalid_response/);
});

test("successful session and network failures remain distinguishable", async () => {
    const data = { success: true, user: { userId: "test-user", orgId: "test-org" } };
    assert.deepEqual(await fetchSessionResponse(async () => Response.json(data)), data);
    await assert.rejects(fetchSessionResponse(async () => { throw new Error("offline"); }), /offline/);
});

test("timeout covers a stalled response body as well", async () => {
    const stalledBody: typeof fetch = async (_url, options) => new Response(new ReadableStream({
        start(controller) {
            options!.signal!.addEventListener("abort", () => controller.error(new Error("body_aborted")), { once: true });
        },
    }));
    await assert.rejects(fetchSessionResponse(stalledBody, 10), /body_aborted/);
});
