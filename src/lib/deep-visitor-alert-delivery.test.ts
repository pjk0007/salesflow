import { test } from "node:test";
import assert from "node:assert";
import {
    deliverClaimedBatch,
    isWebhookConfigError,
    NO_WEBHOOK_ERROR,
    POST_INTERVAL_MS,
    type ClaimedAlert,
    type DeliveryDeps,
} from "./deep-visitor-alert-delivery";
import { MAX_ATTEMPTS, RETRY_DELAY_MS } from "./deep-visitor-alert-rules";
import type { GoogleChatResult } from "./google-chat";

// 진짜 주소가 아니다
const HOOK_8 = "https://chat.example.test/v1/spaces/AAAA8/messages?key=fake-key&token=fake-token-8";
const HOOK_9 = "https://chat.example.test/v1/spaces/AAAA9/messages?key=fake-key&token=fake-token-9";
const NOW = new Date("2026-10-05T09:00:00+09:00");

const row = (id: number, workspaceId = 8, attempts = 1): ClaimedAlert => ({
    id,
    workspaceId,
    recordId: 770000 + id,
    message: `카드 ${id}`,
    attempts,
});

type Call = [string, ...unknown[]];

interface FakeOpts {
    /** 웹훅별로 차례대로 돌려줄 결과 (마지막 것을 되풀이) */
    results?: Partial<Record<string, GoogleChatResult[]>>;
    webhooks?: Record<number, string>;
    /** 이 횟수만큼 markSent가 던진다 */
    markSentFailures?: number;
    markSkippedThrows?: boolean;
    /** 몇 번째 overBudget 호출부터 true인가 (0부터) */
    budgetAfterChecks?: number;
}

function fakeDeps(opts: FakeOpts = {}): { deps: DeliveryDeps; calls: Call[] } {
    const calls: Call[] = [];
    const posts = new Map<string, number>();
    let sentFailures = opts.markSentFailures ?? 0;
    let budgetChecks = 0;
    const deps: DeliveryDeps = {
        now: NOW,
        overBudget: () => opts.budgetAfterChecks !== undefined && budgetChecks++ >= opts.budgetAfterChecks,
        webhookFor: (ws) => (opts.webhooks ?? { 8: HOOK_8, 9: HOOK_9 })[ws],
        post: async (url, text) => {
            calls.push(["post", url === HOOK_8 ? "hook8" : url === HOOK_9 ? "hook9" : url, text]);
            const list = opts.results?.[url] ?? [{ ok: true }];
            const n = posts.get(url) ?? 0;
            posts.set(url, n + 1);
            return list[Math.min(n, list.length - 1)];
        },
        markSent: async (id) => {
            if (sentFailures > 0) {
                sentFailures--;
                calls.push(["markSent:throw", id]);
                throw new Error("connection terminated");
            }
            calls.push(["markSent", id]);
        },
        markSkipped: async (id, reason) => {
            if (opts.markSkippedThrows) throw new Error("connection terminated");
            calls.push(["markSkipped", id, reason]);
        },
        markFailed: async (id, error) => {
            calls.push(["markFailed", id, error]);
        },
        requeue: async (id, error, at) => {
            calls.push(["requeue", id, error, at.toISOString()]);
        },
        release: async (ids, lastError) => {
            calls.push(lastError === undefined ? ["release", ids] : ["release", ids, lastError]);
        },
        sleep: async (ms) => {
            calls.push(["sleep", ms]);
        },
        log: () => {},
    };
    return { deps, calls };
}

const fail = (status: number | null, retryable: boolean, error = `구글 챗 응답 ${status}`): GoogleChatResult => ({
    ok: false,
    status,
    error,
    retryable,
});

test("성공하면 sent로 남기고 보내기 사이를 띄운다", async () => {
    const { deps, calls } = fakeDeps();
    const state = { posted: 0 };
    const tally = await deliverClaimedBatch([row(1), row(2)], new Map(), deps, state);
    assert.deepEqual(calls, [
        ["post", "hook8", "카드 1"],
        ["markSent", 1],
        ["sleep", POST_INTERVAL_MS],
        ["post", "hook8", "카드 2"],
        ["markSent", 2],
    ]);
    assert.equal(tally.sent, 2);
    assert.equal(state.posted, 2);
});

test("보내기 전 재확인에 걸린 줄은 보내지 않고 이유를 남겨 닫는다 (B22)", async () => {
    const { deps, calls } = fakeDeps();
    const reasons = new Map([[1, "보내기 전 재확인: 수신거부"]]);
    const tally = await deliverClaimedBatch([row(1), row(2)], reasons, deps, { posted: 0 });
    assert.deepEqual(calls, [
        ["markSkipped", 1, "보내기 전 재확인: 수신거부"],
        ["post", "hook8", "카드 2"],
        ["markSent", 2],
    ]);
    assert.equal(tally.skipped, 1);
    assert.equal(tally.sent, 1);
});

test("웹훅이 없는 워크스페이스 줄은 skipped로 닫는다", async () => {
    const { deps, calls } = fakeDeps({ webhooks: { 9: HOOK_9 } });
    const tally = await deliverClaimedBatch([row(1, 8)], new Map(), deps, { posted: 0 });
    assert.deepEqual(calls, [["markSkipped", 1, NO_WEBHOOK_ERROR]]);
    assert.equal(tally.skipped, 1);
});

test("400은 그 줄만 실패, 429·5xx는 시도가 남았으면 10분 뒤 다시, 다 썼으면 실패", async () => {
    const { deps, calls } = fakeDeps({
        results: {
            [HOOK_8]: [fail(400, false), fail(503, true), fail(503, true)],
        },
    });
    const tally = await deliverClaimedBatch(
        [row(1), row(2, 8, 1), row(3, 8, MAX_ATTEMPTS)],
        new Map(),
        deps,
        { posted: 0 }
    );
    const writes = calls.filter((c) => c[0] !== "post" && c[0] !== "sleep");
    assert.deepEqual(writes, [
        ["markFailed", 1, "구글 챗 응답 400"],
        ["requeue", 2, "구글 챗 응답 503", new Date(NOW.getTime() + RETRY_DELAY_MS).toISOString()],
        ["markFailed", 3, "구글 챗 응답 503"],
    ]);
    assert.deepEqual([tally.failed, tally.requeued], [2, 1]);
});

test("웹훅 설정 오류(401·403·404)는 시도로 세지 않고 되돌리며, 그 워크스페이스 남은 줄은 보내지 않는다", async () => {
    assert.deepEqual([401, 403, 404].map(isWebhookConfigError), [true, true, true]);
    assert.deepEqual([400, 429, 500, null].map(isWebhookConfigError), [false, false, false, false]);

    const { deps, calls } = fakeDeps({ results: { [HOOK_8]: [fail(404, false, `구글 챗 응답 404: ${HOOK_8} 없음`)] } });
    const tally = await deliverClaimedBatch([row(1, 8), row(2, 9), row(3, 8)], new Map(), deps, { posted: 0 });
    assert.equal(calls.filter((c) => c[0] === "post").length, 2); // 8번 한 번, 9번 한 번
    const release = calls.filter((c) => c[0] === "release");
    assert.equal(release.length, 2);
    assert.deepEqual(release[0].slice(0, 2), ["release", [1]]);
    assert.match(String(release[0][2]), /^웹훅 설정 오류/);
    // 오류 글에 웹훅 주소가 남지 않는다
    assert.ok(!String(release[0][2]).includes("fake-token-8"), String(release[0][2]));
    assert.deepEqual(release[1], ["release", [3]]);
    assert.deepEqual(calls.find((c) => c[0] === "markSent"), ["markSent", 2]);
    assert.equal(calls.some((c) => c[0] === "markFailed"), false);
    assert.deepEqual(tally.brokenWorkspaces, [8]);
    assert.deepEqual([tally.deferred, tally.sent], [2, 1]);
});

test("보낸 뒤 sent 기록이 한 번 실패해도 다시 기록한다 (중복 발송 없음)", async () => {
    const { deps, calls } = fakeDeps({ markSentFailures: 1 });
    const tally = await deliverClaimedBatch([row(1)], new Map(), deps, { posted: 0 });
    assert.deepEqual(
        calls.filter((c) => c[0] !== "sleep"),
        [["post", "hook8", "카드 1"], ["markSent:throw", 1], ["markSent", 1]]
    );
    assert.equal(tally.sent, 1);
});

test("sent 기록이 계속 실패하면 남은 줄만 되돌리고 오류를 올린다 — 이미 보낸 줄은 되돌리지 않는다", async () => {
    const { deps, calls } = fakeDeps({ markSentFailures: 99 });
    await assert.rejects(deliverClaimedBatch([row(1), row(2), row(3)], new Map(), deps, { posted: 0 }), /connection terminated/);
    assert.equal(calls.filter((c) => c[0] === "post").length, 1);
    assert.deepEqual(calls.filter((c) => c[0] === "release"), [["release", [2, 3]]]);
});

test("보내기 전에 오류가 나면 지금 줄까지 되돌린다", async () => {
    const { deps, calls } = fakeDeps({ markSkippedThrows: true });
    await assert.rejects(
        deliverClaimedBatch([row(1), row(2)], new Map([[1, "보내기 전 재확인: 수신거부"]]), deps, { posted: 0 }),
        /connection terminated/
    );
    assert.deepEqual(calls, [["release", [1, 2]]]);
});

test("예산을 다 쓰면 남은 줄을 시도 수와 함께 되돌리고 멈춘다", async () => {
    const { deps, calls } = fakeDeps({ budgetAfterChecks: 1 });
    const tally = await deliverClaimedBatch([row(1), row(2), row(3)], new Map(), deps, { posted: 0 });
    assert.deepEqual(calls, [
        ["post", "hook8", "카드 1"],
        ["markSent", 1],
        ["release", [2, 3]],
    ]);
    assert.equal(tally.budgetHit, true);
});
