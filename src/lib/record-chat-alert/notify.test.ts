import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../auth-fake-db.test-helper";
import type { GoogleChatResult } from "../google-chat";

type Failure = { error: string; status: number | null; attempts: number };

async function run(results: GoogleChatResult[], idempotent = false) {
    const { deliverRecordChatAlert, CHAT_ALERT_RETRY_DELAYS_MS } = await import("./notify");
    const waits: number[] = [];
    const failures: Failure[] = [];
    let posts = 0;
    const outcome = await deliverRecordChatAlert({
        idempotent,
        post: async () => results[Math.min(posts++, results.length - 1)],
        wait: async (ms) => { waits.push(ms); },
        recordFailure: async (f) => { failures.push(f); },
    });
    return { outcome, waits, failures, posts, delays: CHAT_ALERT_RETRY_DELAYS_MS };
}

const ok: GoogleChatResult = { ok: true };
const rateLimited: GoogleChatResult = { ok: false, status: 429, error: "구글 챗 요청 한도", retryable: true };
const gone: GoogleChatResult = { ok: false, status: 404, error: "웹훅을 찾을 수 없습니다", retryable: false };
const timeout: GoogleChatResult = { ok: false, status: null, error: "응답 시간 초과", retryable: true, uncertain: true };

test("UX-287 성공하면 한 번만 보내고 실패 기록을 남기지 않는다", async (t) => {
    isolateEnv(t);
    const r = await run([ok]);
    assert.deepEqual(r.outcome, { ok: true, attempts: 1 });
    assert.equal(r.posts, 1);
    assert.deepEqual(r.waits, []);
    assert.deepEqual(r.failures, []);
});

test("UX-287 일시 실패(429·5xx)는 지연 뒤 다시 보내고 회복하면 기록하지 않는다", async (t) => {
    isolateEnv(t);
    const r = await run([rateLimited, ok]);
    assert.deepEqual(r.outcome, { ok: true, attempts: 2 });
    assert.deepEqual(r.waits, [r.delays[0]]);
    assert.deepEqual(r.failures, []);
});

test("UX-287 재시도를 다 써도 실패하면 레코드 이력에 한 번 남긴다", async (t) => {
    isolateEnv(t);
    const r = await run([rateLimited]);
    assert.equal(r.outcome.ok, false);
    assert.equal(r.posts, r.delays.length + 1);
    assert.deepEqual(r.waits, [...r.delays]);
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].attempts, r.delays.length + 1);
    assert.equal(r.failures[0].status, 429);
});

test("UX-287 웹훅 삭제·권한 같은 영구 실패는 다시 보내지 않고 바로 기록한다", async (t) => {
    isolateEnv(t);
    const r = await run([gone, ok]);
    assert.equal(r.posts, 1);
    assert.deepEqual(r.waits, []);
    assert.deepEqual(r.failures, [{ error: gone.ok ? "" : gone.error, status: 404, attempts: 1 }]);
});

test("UX-287 시간 초과는 requestId가 없으면 다시 보내지 않고(중복 게시 방지) '확인 필요'로 남기며, requestId가 있으면 다시 보낸다", async (t) => {
    isolateEnv(t);
    const plain = await run([timeout, ok]);
    assert.equal(plain.posts, 1);
    assert.equal(plain.failures.length, 1);
    assert.match(plain.failures[0].error, /확인해주세요/);

    const keyed = await run([timeout, ok], true);
    assert.deepEqual(keyed.outcome, { ok: true, attempts: 2 });
    assert.deepEqual(keyed.failures, []);
});

test("UX-287 실패 이벤트는 여정 단계·퍼널 판정에 섞이지 않는다", async (t) => {
    isolateEnv(t);
    const { CHAT_ALERT_FAILED_EVENT } = await import("./notify");
    const { isFunnelRecordEvent } = await import("../deep-visitor-alert-rules");
    assert.equal(isFunnelRecordEvent(CHAT_ALERT_FAILED_EVENT, ["신규", "상담중", "계약"]), false);
    assert.ok(!["match_stage", "status", "consult", "signup"].includes(CHAT_ALERT_FAILED_EVENT.type));
});
