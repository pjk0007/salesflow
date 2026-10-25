import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./auth-fake-db.test-helper";
import { postGoogleChatMessage, resetChatSpaceSlots } from "./google-chat";

// 가짜 웹훅 주소 — fetch는 늘 가짜다. 실제 구글 챗으로 보내지 않는다
const WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAAAfake/messages?key=fake-key&token=fake-token";
const ALERT = { id: 77, org_id: "00000000-0000-4000-8000-000000000001", workspace_id: 3, record_id: 42 };
const MESSAGE = { text: "고객 여정", cardsV2: [{ cardId: "c", card: {} }] };
const ENV = { NEXT_PUBLIC_BASE_URL: "https://sendb.kr" };

/** 구글 챗 흉내: 같은 messageId가 두 번 오면 409(이미 있음) — 실제 웹훅의 고정 ID 동작 */
function fakeChat(firstStatus = 200) {
    const seen = new Set<string>();
    const posted: string[] = [];
    const urls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
        const u = new URL(String(input));
        urls.push(u);
        const id = u.searchParams.get("messageId") ?? "";
        if (id && seen.has(id)) return new Response('{"error":{"message":"already exists"}}', { status: 409 });
        if (urls.length === 1 && firstStatus !== 200) return new Response("{}", { status: firstStatus });
        if (id) seen.add(id);
        posted.push(id);
        return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const post: typeof postGoogleChatMessage = (url, message, _f, opts) =>
        postGoogleChatMessage(url, message, fetchImpl, { ...opts, spaceIntervalMs: 0, retryDelayMs: 0 });
    return { post, posted, urls };
}

async function load(t: Parameters<typeof isolateEnv>[0]) {
    isolateEnv(t);
    resetChatSpaceSlots();
    return import("./customer-journey-alert");
}

test("UX-224 성공 후 sent 기록이 실패해 다음 회차에 다시 보내도 같은 messageId라 채팅에는 한 번만 올라간다", async (t) => {
    const { deliverJourneyCard } = await load(t);
    const chat = fakeChat();
    let marks = 0;
    const failingMark = async () => {
        marks++;
        throw new Error("DB 연결 끊김");
    };
    await assert.rejects(
        deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: ALERT, markSent: failingMark, sleep: async () => {} }),
        /DB 연결 끊김/,
    );
    assert.equal(marks, 3, "sent 기록은 깊이 알림과 같은 횟수(3)까지 다시 해 본다");
    // 다음 회차(줄은 pending으로 남아 다시 집힘)
    let recorded = false;
    const second = await deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: ALERT, markSent: async () => { recorded = true; } });
    assert.deepEqual(second, { ok: true });
    assert.ok(recorded);
    assert.equal(chat.posted.length, 1, "채팅에 올라간 글은 한 통");
    assert.equal(chat.urls[0].searchParams.get("messageId"), chat.urls[1].searchParams.get("messageId"));
    assert.equal(chat.urls[0].searchParams.has("requestId"), false);
});

test("UX-224 일시 DB 오류 한 번은 다시 기록해 성공으로 끝난다", async (t) => {
    const { deliverJourneyCard } = await load(t);
    const chat = fakeChat();
    let marks = 0;
    const r = await deliverJourneyCard({
        post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: ALERT, sleep: async () => {},
        markSent: async () => { if (++marks === 1) throw new Error("일시 오류"); },
    });
    assert.deepEqual(r, { ok: true });
    assert.equal(marks, 2);
});

test("UX-224 알림 줄·서버가 다르면 다른 ID(다른 방문 카드를 409로 삼키지 않는다), 멘션·스레드는 그대로", async (t) => {
    const { deliverJourneyCard } = await load(t);
    const chat = fakeChat();
    const noop = async () => {};
    await deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: ALERT, markSent: noop, mentionUserId: "123456789" });
    await deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: { ...ALERT, id: 78 }, markSent: noop });
    await deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: { NEXT_PUBLIC_BASE_URL: "https://dev.example.test" }, alert: ALERT, markSent: noop });
    assert.equal(chat.posted.length, 3);
    assert.equal(new Set(chat.posted).size, 3);
    assert.equal(chat.urls[0].searchParams.get("messageReplyOption"), "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
});

test("UX-224 재시도 가능한 실패(5xx)는 sent로 기록하지 않고 결과를 돌려준다, 같은 ID로 재시도 시 중복 없음", async (t) => {
    const { deliverJourneyCard } = await load(t);
    const chat = fakeChat(503);
    let recorded = 0;
    const r = await deliverJourneyCard({ post: chat.post, webhookUrl: WEBHOOK, message: MESSAGE, env: ENV, alert: ALERT, markSent: async () => { recorded++; } });
    // 공통 전송이 5xx를 한 번 다시 보낸다 — 같은 ID라 409로 끝나지 않고 처음 올라간다
    assert.deepEqual(r, { ok: true });
    assert.equal(recorded, 1);
    assert.equal(chat.posted.length, 1);
});
