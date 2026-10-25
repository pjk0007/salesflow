// UX-152 — 공개 수신거부: 잘못된 링크만 막다른 안내, 일시 오류는 같은 요청을 다시 할 수 있고 영어 원문이 보이지 않는다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fetchUnsubscribeTarget, submitUnsubscribe } from "../api/unsubscribe";
import { unsubscribeFailureStatus } from "./failure";

function serve(t: TestContext, replies: Array<() => Response | Promise<Response>>) {
    let i = 0;
    t.mock.method(globalThis, "fetch", async () => {
        const reply = replies[Math.min(i++, replies.length - 1)];
        return reply();
    });
    return () => i;
}
const hasEnglish = (text: string) => /[A-Za-z]{4,}/.test(text);

async function failureOf(run: () => Promise<unknown>) {
    try {
        await run();
    } catch (error) {
        return error;
    }
    assert.fail("실패해야 한다");
}

test("404 잘못된 토큰 → invalid, 서버 한국어 문구", async (t) => {
    serve(t, [() => Response.json({ success: false, error: "유효하지 않거나 만료된 링크입니다." }, { status: 404 })]);
    const status = unsubscribeFailureStatus(await failureOf(() => fetchUnsubscribeTarget("bad")), "load");
    assert.deepEqual(status, { kind: "invalid", message: "유효하지 않거나 만료된 링크입니다." });
});

test("조회 네트워크 실패·서버 500(HTML) → 다시 조회할 수 있는 error, 영어 원문 없음", async (t) => {
    for (const reply of [
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => new Response("<html>Internal Server Error</html>", { status: 500, headers: { "content-type": "text/html" } }),
    ]) {
        await t.test(String(reply).slice(0, 40), async (t) => {
            serve(t, [reply as () => Response]);
            const status = unsubscribeFailureStatus(await failureOf(() => fetchUnsubscribeTarget("tok")), "load");
            assert.equal(status.kind, "error");
            assert.equal(status.kind === "error" && status.retry, "load");
            assert.equal(hasEnglish(status.kind === "error" ? status.message : ""), false);
        });
    }
});

test("POST 응답 유실 후 재시도: 첫 요청 실패 → submit 재시도 상태(이메일 유지), 두 번째 성공(서버 멱등) → 완료 가능", async (t) => {
    const calls = serve(t, [
        () => Promise.reject(new TypeError("network connection lost")),
        () => Response.json({ success: true, data: { email: "lead@example.test" } }),
    ]);
    const status = unsubscribeFailureStatus(await failureOf(() => submitUnsubscribe("tok")), "submit", "lead@example.test");
    assert.equal(status.kind, "error");
    assert.equal(status.kind === "error" && status.retry, "submit");
    assert.equal(status.kind === "error" && status.email, "lead@example.test");
    await submitUnsubscribe("tok");
    assert.equal(calls(), 2);
});

test("이미 거부한 주소 조회는 그대로 alreadyUnsubscribed", async (t) => {
    serve(t, [() => Response.json({ success: true, data: { email: "lead@example.test", alreadyUnsubscribed: true } })]);
    assert.deepEqual(await fetchUnsubscribeTarget("tok"), { email: "lead@example.test", alreadyUnsubscribed: true });
});
