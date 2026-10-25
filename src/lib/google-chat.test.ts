import { test } from "node:test";
import assert from "node:assert";
import {
    chatMessageIdFor,
    chatFixedMessageIdEnabled,
    chatWebhookProblem,
    postGoogleChatText,
    resetChatSpaceSlots,
    type GoogleChatResult,
} from "./google-chat";

// 진짜 주소가 아니다. 모양만 구글 챗 수신 웹훅을 흉내 낸다 (fetch는 늘 가짜다)
const SPACE_PATH = "/v1/spaces/AAAAfakeSpace/messages";
const FAKE_KEY = "fake-key-AIzaSyNotReal";
const FAKE_TOKEN = "fake-token-NotARealToken0001=";
const WEBHOOK = `https://chat.googleapis.com${SPACE_PATH}?key=${FAKE_KEY}&token=${encodeURIComponent(FAKE_TOKEN)}`;
const OTHER = "https://chat.googleapis.com/v1/spaces/BBBBother/messages?key=fake&token=fake-2";

type Step = { status: number; body?: string; headers?: Record<string, string> } | { throw: unknown };

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
        return new Response(step.body ?? "{}", { status: step.status, headers: step.headers });
    }) as typeof fetch;
    return { fetchImpl, calls };
}

function assertNoSecret(error: string) {
    assert.ok(!error.includes(WEBHOOK), `오류 글에 웹훅 주소가 있다: ${error}`);
    assert.ok(!error.includes(SPACE_PATH), `오류 글에 스페이스 경로가 있다: ${error}`);
    assert.ok(!error.includes(FAKE_KEY), `오류 글에 key가 있다: ${error}`);
    assert.ok(!error.includes(FAKE_TOKEN.slice(0, 20)), `오류 글에 token이 있다: ${error}`);
    assert.ok(!error.includes(encodeURIComponent(FAKE_KEY + "x").slice(0, 10) + "NotReal"), `오류 글에 인코딩된 key가 있다: ${error}`);
}

const NO_WAIT = { retryDelayMs: 0, spaceIntervalMs: 0 };

test("웹훅 고정 messageId는 requestId 없이 전송하고 같은 ID의 409를 성공으로 처리한다", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 409 }]);
    assert.deepEqual(await postGoogleChatText(WEBHOOK, "글", fetchImpl, { ...NO_WAIT, messageId: "client-inbox-abc123", threadKey: "inbox:fake" }), { ok: true });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("messageId"), "client-inbox-abc123");
    assert.equal(url.searchParams.has("requestId"), false);
    assert.equal(url.searchParams.get("messageReplyOption"), "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
});

test("잘못된 고정 messageId는 외부 호출 전에 거절한다", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    for (const messageId of ["abc", "client-UPPER", "client-", `client-${"a".repeat(57)}`]) {
        assert.equal((await postGoogleChatText(WEBHOOK, "글", fetchImpl, { ...NO_WAIT, messageId })).ok, false);
    }
    assert.equal(calls.length, 0);
});

function failed(r: GoogleChatResult) {
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    return r;
}

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

test("429 뒤 성공하면 다시 보내 성공한다 (B19)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 429 }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 2);
});

test("429는 두 번까지 다시 보낸다 — 세 번 다 429면 다시 시도할 수 있는 실패 (CT-2)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 429 }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assert.equal(calls.length, 3);
    assert.equal(r.status, 429);
    assert.equal(r.retryable, true);
    assert.match(r.error, /^구글 챗이 잠시 막았습니다 \(스페이스당 초당 1통 한도\) \(구글 챗 429/);
});

test("5xx가 두 번(500·503)이면 다시 시도할 수 있는 실패로 끝나고 주소는 오류 글에 없다 (B19)", async () => {
    const body = JSON.stringify({ error: { code: 500, message: `Internal error for ${WEBHOOK}` } });
    const { fetchImpl, calls } = fakeFetch([{ status: 500, body }, { status: 503, body }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assert.equal(calls.length, 2);
    assert.equal(r.status, 503);
    assert.equal(r.retryable, true);
    assert.match(r.error, /^구글 챗 쪽 일시 장애 \(구글 챗 503/);
    assertNoSecret(r.error);
});

test("400은 다시 보내지 않고, 한국어 풀이 뒤에 구글 원문을 괄호로 둔다 (B19·CT-11)", async () => {
    const body = JSON.stringify({ error: { code: 400, message: "Invalid JSON payload received.", status: "INVALID_ARGUMENT" } });
    const { fetchImpl, calls } = fakeFetch([{ status: 400, body }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT);
    assert.equal(calls.length, 1);
    assert.deepEqual(r, {
        ok: false,
        status: 400,
        error: "구글 챗이 글을 받지 않았습니다 (글 형식 문제) (구글 챗 400: Invalid JSON payload received.)",
        retryable: false,
    });
});

test("401·403·404는 고칠 일을 한국어로 앞에 쓴다 (CT-11·WPN-9)", async () => {
    for (const [status, re] of [
        [401, /^웹훅 주소의 열쇠\(key·token\)가 맞지 않습니다/],
        [403, /^Workspace 관리자가 웹훅을 막았거나/],
        [404, /^스페이스에서 웹훅이 지워졌거나 주소가 틀렸습니다/],
    ] as const) {
        const body = JSON.stringify({ error: { code: status, message: "The caller does not have permission" } });
        const { fetchImpl, calls } = fakeFetch([{ status, body }]);
        const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
        assert.equal(calls.length, 1);
        assert.equal(r.retryable, false);
        assert.match(r.error, re);
        assert.match(r.error, /\(구글 챗 \d{3}: The caller does not have permission\)$/);
    }
});

test("HTML 오류 쪽은 <title>만 남긴다 (CT-11)", async () => {
    const html = "<!DOCTYPE html><html lang=en><meta charset=utf-8><title>Error 503 (Service Unavailable)!!1</title><p>That’s an error.</p></html>";
    const { fetchImpl } = fakeFetch([{ status: 503, body: html }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assert.equal(r.error, "구글 챗 쪽 일시 장애 (구글 챗 503: Error 503 (Service Unavailable)!!1)");
    assert.ok(!r.error.includes("<"));
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
        cause: new Error(`getaddrinfo ENOTFOUND chat.googleapis.com key=${FAKE_KEY}&token=${FAKE_TOKEN}`),
    });
    const { fetchImpl, calls } = fakeFetch([{ throw: err }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assert.equal(calls.length, 2);
    assert.equal(r.status, null);
    assert.equal(r.retryable, true);
    assert.match(r.error, /^구글 챗에 연결하지 못했습니다/);
    assertNoSecret(r.error);
});

test("URL 인코딩된 key·token도 오류 글에서 지운다 (CT-9)", async () => {
    const encoded = `upstream failed original=%3Fkey%3D${encodeURIComponent(FAKE_KEY)}%26token%3D${encodeURIComponent(FAKE_TOKEN)} and ${encodeURIComponent(WEBHOOK)}`;
    const { fetchImpl } = fakeFetch([{ status: 502, body: encoded }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assertNoSecret(r.error);
    assert.ok(!r.error.includes(encodeURIComponent(FAKE_TOKEN)), r.error);
    assert.ok(!r.error.includes("AIzaSyNotReal"), r.error);
});

test("시간 초과는 다시 보내지 않고 uncertain으로 돌려준다 — 구글이 이미 올렸을 수 있다 (CT-1)", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { fetchImpl, calls } = fakeFetch([{ throw: timeout }]);
    const r = failed(await postGoogleChatText(WEBHOOK, "글", fetchImpl, NO_WAIT));
    assert.equal(calls.length, 1);
    assert.equal(r.retryable, true);
    assert.equal(r.uncertain, true);
    assert.match(r.error, /^구글 챗 응답이 10초 안에 오지 않았습니다/);
});

test("https가 아닌 주소는 보내지 않고 주소도 오류 글에 넣지 않는다", async () => {
    const plain = WEBHOOK.replace("https://", "http://");
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const r = failed(await postGoogleChatText(plain, "글", fetchImpl, NO_WAIT));
    assert.equal(calls.length, 0);
    assert.equal(r.retryable, false);
    assert.ok(!r.error.includes(FAKE_KEY));
});

test("구글 챗이 아닌 호스트·경로는 보내지 않는다 (CT-6·DV-3)", async () => {
    for (const url of [
        "https://example.com/hook?key=a&token=b",
        "https://chat.googleapi.com/v1/spaces/X/messages?key=a&token=b",
        "https://chat.googleapis.com/v1/other/X?key=a&token=b",
        "https://chat.googleapis.com.evil.test/v1/spaces/X/messages?key=a",
    ]) {
        const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
        const r = failed(await postGoogleChatText(url, "글", fetchImpl, NO_WAIT));
        assert.equal(calls.length, 0, url);
        assert.equal(r.retryable, false);
        assert.match(r.error, /구글 챗 수신 웹훅 주소가 아님/);
    }
    assert.equal(chatWebhookProblem(WEBHOOK), null);
    assert.equal(chatWebhookProblem(""), "missing");
    assert.equal(chatWebhookProblem("http://chat.googleapis.com/v1/spaces/X/messages"), "not_https");
});

test("다시 보내기 전에 정한 시간만큼 기다린다", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 502 }, { status: 200 }]);
    const t0 = Date.now();
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, { retryDelayMs: 50, spaceIntervalMs: 0 });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - t0 >= 45);
});

test("429의 Retry-After를 따른다 (CT-2)", async () => {
    const waits: number[] = [];
    const { fetchImpl } = fakeFetch([{ status: 429, headers: { "retry-after": "3" } }, { status: 200 }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, {
        spaceIntervalMs: 0,
        sleep: async (ms) => void waits.push(ms),
        random: () => 0,
    });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(waits, [3000]);
});

test("다시 보내기에는 무작위 지연이 더해진다 — 같이 부딪힌 요청이 다시 같이 부딪히지 않게 (CT-2)", async () => {
    const waits: number[] = [];
    const { fetchImpl } = fakeFetch([{ status: 500 }, { status: 200 }]);
    await postGoogleChatText(WEBHOOK, "글", fetchImpl, { spaceIntervalMs: 0, sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
    assert.deepEqual(waits, [1500 + 500]);
});

test("같은 스페이스는 프로세스 안에서 1.1초 간격으로 줄을 선다, 다른 스페이스는 기다리지 않는다 (CT-2)", async () => {
    resetChatSpaceSlots();
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const { fetchImpl } = fakeFetch([{ status: 200 }]);
    await Promise.all([
        postGoogleChatText(WEBHOOK, "1", fetchImpl, { sleep }),
        postGoogleChatText(WEBHOOK.replace(FAKE_KEY, "other-key"), "2", fetchImpl, { sleep }),
        postGoogleChatText(OTHER, "3", fetchImpl, { sleep }),
    ]);
    // 첫 통은 바로, 같은 스페이스의 둘째 통(다른 웹훅이어도)은 약 1.1초 뒤, 다른 스페이스는 바로
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 1000 && waits[0] <= 1100, String(waits[0]));
    resetChatSpaceSlots();
});

test("'<users/…>' 멘션은 마지막에 막는다 (CT-4)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    await postGoogleChatText(WEBHOOK, "메모: <users/all> 확인 <users/12345>", fetchImpl, NO_WAIT);
    assert.equal(JSON.parse(String(calls[0].init?.body)).text, "메모: ‹users/all> 확인 ‹users/12345>");
});

test("UX-221 threadKey·고정 messageId를 웹훅 문서 모양으로 붙이고 requestId는 보내지 않는다, 같은 ID의 409는 이미 올라간 것 (DV-8·CT-1)", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 409 }]);
    const messageId = chatMessageIdFor({}, "reply", 1);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, { ...NO_WAIT, threadKey: "reply-r1", messageId });
    assert.deepEqual(r, { ok: true });
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("messageReplyOption"), "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    assert.equal(u.searchParams.get("messageId"), messageId);
    assert.equal(u.searchParams.has("requestId"), false);
    assert.equal(u.searchParams.get("key"), FAKE_KEY);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { text: "글", thread: { threadKey: "reply-r1" } });
    // 고정 ID 없이 온 409는 실패다
    const plain = fakeFetch([{ status: 409 }]);
    assert.equal((await postGoogleChatText(WEBHOOK, "글", plain.fetchImpl, NO_WAIT)).ok, false);
});

test("UX-221 400은 고정 ID가 있어도 다시 보내지 않는 확정 실패", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 400, body: '{"error":{"message":"Invalid argument"}}' }]);
    const r = await postGoogleChatText(WEBHOOK, "글", fetchImpl, { ...NO_WAIT, messageId: chatMessageIdFor({}, "deep", 3) });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.retryable, false);
    assert.equal(calls.length, 1);
});

test("UX-221 고정 messageId는 플래그와 무관하게 만들 수 있고, 형식이 맞고, 같은 입력이면 같고 서버 주소·종류가 다르면 다르다", () => {
    assert.equal(chatFixedMessageIdEnabled({}), false);
    assert.equal(chatFixedMessageIdEnabled({ GOOGLE_CHAT_REQUEST_ID: " ON " }), true);
    const env = { NEXT_PUBLIC_BASE_URL: "https://sendb.kr" };
    const a = chatMessageIdFor(env, "deep", 41);
    assert.match(a, /^client-[a-z0-9-]{1,56}$/);
    assert.ok(a.length <= 63);
    assert.equal(chatMessageIdFor(env, "deep", 41), a);
    assert.notEqual(chatMessageIdFor(env, "reply", 41), a);
    assert.notEqual(chatMessageIdFor({ NEXT_PUBLIC_BASE_URL: "https://dev.example.test" }, "deep", 41), a);
    assert.match(chatMessageIdFor(env, "Journey_Card!!", 1), /^client-journeycard-[0-9a-f]{32}$/);
});
