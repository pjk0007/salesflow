import { test } from "node:test";
import assert from "node:assert";
import { postGoogleChatText } from "./google-chat";

// 진짜 주소가 아니다. 모양만 구글 챗 수신 웹훅을 흉내 낸다
const SPACE_PATH = "/v1/spaces/AAAAfakeSpace/messages";
const FAKE_KEY = "fake-key-AIzaSyNotReal";
const FAKE_TOKEN = "fake-token-NotARealToken0001";
const WEBHOOK = `https://chat.example.test${SPACE_PATH}?key=${FAKE_KEY}&token=${FAKE_TOKEN}`;

type Step = { status: number; body?: string } | { throw: unknown };

interface Call {
    url: string;
    init: RequestInit | undefined;
}

/** 정해 둔 순서대로 응답하거나 던지는 가짜 fetch */
function fakeFetch(steps: Step[]): { fetchImpl: typeof fetch; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        const step = steps[Math.min(calls.length - 1, steps.length - 1)];
        if ("throw" in step) throw step.throw;
        return new Response(step.body ?? "{}", { status: step.status });
    }) as typeof fetch;
    return { fetchImpl, calls };
}

function assertNoSecret(error: string) {
    assert.ok(!error.includes(WEBHOOK), `오류 글에 웹훅 주소가 있다: ${error}`);
    assert.ok(!error.includes(SPACE_PATH), `오류 글에 스페이스 경로가 있다: ${error}`);
    assert.ok(!error.includes(FAKE_KEY), `오류 글에 key가 있다: ${error}`);
    assert.ok(!error.includes(FAKE_TOKEN), `오류 글에 token이 있다: ${error}`);
}

const NO_WAIT = { retryDelayMs: 0 };

test("성공하면 한 번만 보내고 JSON {text}를 UTF-8로 보낸다 (B19)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "🔔 *디하 · 깊이 들어온 사람*", fetchImpl, NO_WAIT);
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, WEBHOOK);
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(calls[0].init?.headers, { "content-type": "application/json; charset=UTF-8" });
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { text: "🔔 *디하 · 깊이 들어온 사람*" });
    // 응답이 오지 않는 호출이 회차 전체를 붙잡지 않도록 시간 제한이 걸려 있어야 한다
    assert.ok(calls[0].init?.signal instanceof AbortSignal);
});

test("429 뒤 성공하면 한 번 더 보내 성공한다 (B19)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 429 }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 2);
});

test("5xx가 두 번(500·503)이면 다시 시도할 수 있는 실패로 끝나고 주소는 오류 글에 없다 (B19)", async () => {
    const body = JSON.stringify({ error: { code: 500, message: `Internal error for ${WEBHOOK}` } });
    const { fetchImpl, calls } = fakeFetch([{ status: 500, body }, { status: 503, body }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 2);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 503);
    assert.equal(r.retryable, true);
    assert.match(r.error, /^구글 챗 응답 503/);
    assertNoSecret(r.error);
});

test("400은 다시 보내지 않는다 (B19)", async () => {
    const body = JSON.stringify({ error: { code: 400, message: "Invalid JSON payload received.", status: "INVALID_ARGUMENT" } });
    const { fetchImpl, calls } = fakeFetch([{ status: 400, body }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 1);
    assert.deepEqual(r, {
        ok: false,
        status: 400,
        error: "구글 챗 응답 400: Invalid JSON payload received.",
        retryable: false,
    });
});

test("연결 오류는 한 번 다시 보낸다 (B19)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ throw: new TypeError("fetch failed") }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 2);
});

test("연결 오류가 두 번이면 실패하고, 오류 메시지에 섞인 주소·key·token을 지운다 (B19)", async () => {
    // undici는 주소를 오류 메시지·cause에 넣기도 한다
    const err = new TypeError(`fetch failed for ${WEBHOOK}`, {
        cause: new Error(`getaddrinfo ENOTFOUND chat.example.test key=${FAKE_KEY}&token=${FAKE_TOKEN}`),
    });
    const { fetchImpl, calls } = fakeFetch([{ throw: err }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 2);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, null);
    assert.equal(r.retryable, true);
    assert.match(r.error, /^구글 챗 연결 실패/);
    assertNoSecret(r.error);
});

test("시간 초과는 한국어로 알리고 다시 시도할 수 있는 실패다 (B19)", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { fetchImpl, calls } = fakeFetch([{ throw: timeout }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 2);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.retryable, true);
    assert.equal(r.error, "구글 챗 연결 실패: 응답 시간 초과 (10초)");
});

test("https가 아닌 주소는 보내지 않고 주소도 오류 글에 넣지 않는다", async () => {
    const plain = WEBHOOK.replace("https://", "http://");
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const r = await postGoogleChatText(plain, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 0);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.retryable, false);
    assert.ok(!r.error.includes(FAKE_TOKEN));
});

test("다시 보내기 전에 정한 시간만큼 기다린다", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 502 }, { status: 200 }]);
    const t0 = Date.now();
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, { retryDelayMs: 50 });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - t0 >= 45);
});
