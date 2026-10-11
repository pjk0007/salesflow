import { test } from "node:test";
import assert from "node:assert/strict";
import { createJourneyScheduler, journeySchedulerEnabled } from "./customer-journey-scheduler";

const result = { mode: "dry_run", candidates: 0, created: 0, sent: 0, failed: 0, waitingForWebhook: false };
function harness(run: () => Promise<typeof result>) {
    const pending: { callback: () => Promise<void>; delay: number }[] = [];
    let cancelled = 0;
    const scheduler = createJourneyScheduler({ run, schedule: (callback, delay) => { pending.push({ callback, delay }); return {}; }, cancel: () => { cancelled++; } });
    return { pending, scheduler, cancelled: () => cancelled };
}

test("서버 시작 직후 한 번 실행하고 완료 후 5분 뒤에 다음 회차를 예약한다", async () => {
    const h = harness(async () => result);
    assert.equal(h.pending[0].delay, 20000);
    await h.pending.shift()!.callback();
    assert.equal(h.pending[0].delay, 300000);
    assert.equal(h.scheduler.state.lastResult, result);
    assert.ok(h.scheduler.state.lastCompletedAt);
    h.scheduler.stop();
});

test("처리가 오래 걸려도 실행 중에는 다음 회차를 예약하지 않는다", async () => {
    let finish!: (value: typeof result) => void;
    const h = harness(() => new Promise((resolve) => { finish = resolve; }));
    const running = h.pending.shift()!.callback();
    assert.equal(h.scheduler.state.running, true);
    assert.equal(h.pending.length, 0);
    finish(result);
    await running;
    assert.equal(h.scheduler.state.running, false);
    assert.equal(h.pending.length, 1);
    h.scheduler.stop();
});

test("실패해도 다음 회차를 예약하고 비밀값을 상태에 남기지 않는다", async () => {
    const h = harness(async () => { throw new Error("비밀 주소나 고객 데이터"); });
    await h.pending.shift()!.callback();
    assert.equal(h.scheduler.state.lastError, "고객 여정 정기 처리 실패");
    assert.equal(h.pending[0].delay, 300000);
    h.scheduler.stop();
});

test("실행 중 정지하면 작업 완료 뒤에도 새 회차를 예약하지 않는다", async () => {
    let finish!: (value: typeof result) => void;
    const h = harness(() => new Promise((resolve) => { finish = resolve; }));
    const running = h.pending.shift()!.callback();
    h.scheduler.stop();
    finish(result);
    await running;
    assert.equal(h.pending.length, 0);
    assert.equal(h.cancelled(), 1);
});

test("정기 처리는 운영 서버에서 명시적으로 켜고 대상 사업을 지정해야 시작된다", () => {
    const env = { NEXT_PUBLIC_BASE_URL: "https://sendb.kr", JOURNEY_ALERT_SCHEDULER: "on", JOURNEY_ALERT_MODE: "dry_run", JOURNEY_ALERT_WORKSPACE_IDS: "8,9" };
    assert.equal(journeySchedulerEnabled(env), true);
    assert.equal(journeySchedulerEnabled({ ...env, JOURNEY_ALERT_SCHEDULER: "off" }), false);
    assert.equal(journeySchedulerEnabled({ ...env, NEXT_PUBLIC_BASE_URL: "http://localhost:3100" }), false);
    assert.equal(journeySchedulerEnabled({ ...env, JOURNEY_ALERT_MODE: "off" }), false);
    assert.equal(journeySchedulerEnabled({ ...env, JOURNEY_ALERT_WORKSPACE_IDS: "" }), false);
});
