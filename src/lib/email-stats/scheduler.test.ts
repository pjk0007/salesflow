import test from "node:test";
import assert from "node:assert/strict";
import { createJourneyScheduler } from "../customer-journey-scheduler";
import { emailStatsSchedulerEnabled, emailStatsInterval } from "./scheduler";
test("B10: 간격·첫 지연·실패 문구 선택 옵션을 적용한다", async () => {
    const queue: { callback: () => Promise<void>; delay: number }[] = [];
    const scheduler = createJourneyScheduler<number>({ run: async () => { throw new Error("private"); }, intervalMs: 60000, firstDelayMs: 30000, failureLabel: "통계 처리 실패", schedule: (callback, delay) => { queue.push({ callback, delay }); return {}; }, cancel: () => { } });
    assert.equal(queue[0].delay, 30000); await queue.shift()!.callback();
    assert.equal(queue[0].delay, 60000); assert.equal(scheduler.state.lastError, "통계 처리 실패"); scheduler.stop();
});
test("B10: 이메일 통계 실행 조건과 기본 15분 간격", () => {
    assert.equal(emailStatsSchedulerEnabled({ NODE_ENV: "production" }), true);
    assert.equal(emailStatsSchedulerEnabled({ NODE_ENV: "production", EMAIL_STATS_WORKER: "off" }), false);
    assert.equal(emailStatsSchedulerEnabled({ NODE_ENV: "development" }), false);
    assert.equal(emailStatsSchedulerEnabled({ NODE_ENV: "development", EMAIL_STATS_WORKER: "on" }), true);
    assert.equal(emailStatsInterval({}), 900000);
    assert.equal(emailStatsInterval({ EMAIL_STATS_INTERVAL_MS: "60000" }), 60000);
    assert.equal(emailStatsInterval({ EMAIL_STATS_INTERVAL_MS: "3600000" }), 3600000);
    assert.equal(emailStatsInterval({ EMAIL_STATS_INTERVAL_MS: "59999" }), 900000);
});

test("실패 콜백은 원래 오류를 받는다", async () => {
    let tick: (() => Promise<void>) | undefined;
    let received: unknown;
    const failure = new Error("QA scheduler error");
    const scheduler = createJourneyScheduler({
        run: async () => { throw failure; },
        schedule: callback => { tick = callback; return {}; },
        cancel: () => {},
        onError: (error: unknown) => { received = error; },
    });
    await tick!();
    assert.equal(received, failure);
    scheduler.stop();
});
