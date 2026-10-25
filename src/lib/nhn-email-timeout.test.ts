/**
 * UX-196: NHN 이메일 요청이 응답하지 않으면 제한 시간에 끊는다 — 헤더 지연·본문 지연 모두, 직접 fetch하는 조회 포함.
 * 가상 fetch만 쓴다 (실제 NHN 호출 없음). 가상 fetch는 실제 fetch처럼 signal이 끊기면 연결·본문 읽기를 거절한다.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv } from "./auth-fake-db.test-helper";
import type { NhnEmailClient } from "./nhn-email";

/** nhn-email은 db 모듈을 읽으므로 닫힌 포트 DB 주소를 둔 뒤 불러온다 (연결은 열지 않는다) */
async function load(t: TestContext) {
    isolateEnv(t);
    return import("./nhn-email");
}

type Stall = "headers" | "body";

function stallingFetch(t: TestContext, stall: Stall) {
    const seen: Array<{ method: string; url: string; hadSignal: boolean }> = [];
    t.mock.method(globalThis, "fetch", (url: string, init: RequestInit = {}) => {
        const signal = init.signal;
        seen.push({ method: String(init.method), url: String(url), hadSignal: !!signal });
        const aborted = () => new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
        if (stall === "headers") return aborted();
        // 헤더는 왔지만 본문이 끝나지 않는다 — 실제 fetch는 같은 signal로 본문 읽기도 끊는다
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('{"header":'));
                signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
            },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
    });
    return seen;
}

const calls: Array<[string, (c: NhnEmailClient) => Promise<unknown>]> = [
    ["queryMails(GET)", (c) => c.queryMails({ requestId: "r1" })],
    ["queryUpdatedMails(GET 직접)", (c) => c.queryUpdatedMails({ startMailStatusUpdateDate: "2026-10-25 00:00:00", endMailStatusUpdateDate: "2026-10-25 00:10:00" })],
    ["queryMailsPaged(GET 직접)", (c) => c.queryMailsPaged({ startSendDate: "2026-10-25 00:00:00", endSendDate: "2026-10-25 00:10:00", pageNum: 1, pageSize: 10 })],
    ["listCategories(GET)", (c) => c.listCategories()],
];

for (const stall of ["headers", "body"] as const) {
    for (const [name, call] of calls) {
        test(`UX-196: ${name} — ${stall === "headers" ? "헤더" : "본문"} 지연은 제한 시간에 TimeoutError로 끊는다`, async (t) => {
            const { NhnEmailClient } = await load(t);
            const seen = stallingFetch(t, stall);
            const client = new NhnEmailClient("app", "secret", { timeoutMs: 40 });
            const started = Date.now();
            await assert.rejects(call(client), (e: unknown) => (e as Error).name === "TimeoutError");
            assert(Date.now() - started < 2_000, "제한 시간 근처에서 끝난다");
            assert.equal(seen.length, 1, "자동 재요청하지 않는다");
            assert(seen[0].hadSignal);
        });
    }
}

test("UX-196: 발송(POST)도 제한 시간에 던진다 — 접수 여부를 모르는 오류로 호출부에 넘기고 다시 보내지 않는다", async (t) => {
    const { NhnEmailClient } = await load(t);
    const { db } = await import("./db");
    installFakeDb(t, db, () => []); // 수신거부 없음
    const seen = stallingFetch(t, "headers");
    const client = new NhnEmailClient("app", "secret", { timeoutMs: 40, orgId: "00000000-0000-4000-8000-000000000001" });
    await assert.rejects(
        client.sendEachMail({ senderAddress: "a@example.test", title: "제목", body: "본문", receiverList: [{ receiveMailAddr: "b@example.test", receiveType: "MRT0" }] }),
        (e: unknown) => (e as Error).name === "TimeoutError"
    );
    assert.equal(seen.filter((s) => s.method === "POST").length, 1);
});

test("UX-196: 제한 시간을 따로 주지 않은 클라이언트(결과 동기화·발송 대기열)도 기본 제한 시간을 쓴다", async (t) => {
    const { NhnEmailClient, NHN_EMAIL_TIMEOUT_MS } = await load(t);
    const timeouts: number[] = [];
    const original = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, "timeout", (ms: number) => {
        timeouts.push(ms);
        return original(ms);
    });
    t.mock.method(globalThis, "fetch", async () => Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, body: { data: [], totalCount: 0 } }));
    const client = new NhnEmailClient("app", "secret");
    await client.queryUpdatedMails({ startMailStatusUpdateDate: "a", endMailStatusUpdateDate: "b" });
    await client.queryMailsPaged({ startSendDate: "a", endSendDate: "b", pageNum: 1, pageSize: 1 });
    await client.queryMails({});
    assert.deepEqual(timeouts, [NHN_EMAIL_TIMEOUT_MS, NHN_EMAIL_TIMEOUT_MS, NHN_EMAIL_TIMEOUT_MS]);
});
