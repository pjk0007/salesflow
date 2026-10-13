import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmailSendScheduler, emailSendSchedulerEnabled } from "./email-send-scheduler";

test("AI 준비가 오래 걸려도 30초 예약 전송 확인은 계속한다", async () => {
    const pending: { callback: () => Promise<void>; delay: number }[] = [];
    let complete!: () => void;
    let preparationCalls = 0;
    let deliveryCalls = 0;
    const scheduler = createEmailSendScheduler({
        prepare: () => { preparationCalls++; return new Promise<void>((resolve) => { complete = resolve; }); },
        deliver: async () => { deliveryCalls++; },
        schedule: (callback, delay) => { pending.push({ callback, delay }); return {}; }, cancel: () => {},
    });
    assert.equal(pending[0].delay, 10_000);
    await pending.shift()!.callback();
    assert.equal(pending[0].delay, 30_000);
    await pending.shift()!.callback();
    assert.equal(preparationCalls, 1);
    assert.equal(deliveryCalls, 2);
    complete();
    scheduler.stop();
    await pending.shift()!.callback();
    assert.equal(deliveryCalls, 2);
});

test("전송 실패 후에도 다음 회차가 이어지고 개발 서버에서는 자동 시작하지 않는다", async () => {
    const pending: { callback: () => Promise<void>; delay: number }[] = [];
    const errors: string[] = [];
    const scheduler = createEmailSendScheduler({
        prepare: async () => {}, deliver: async () => { throw new Error("가상 실패"); },
        schedule: (callback, delay) => { pending.push({ callback, delay }); return {}; }, cancel: () => {},
        onError: (stage) => errors.push(stage),
    });
    await pending.shift()!.callback();
    assert.deepEqual(errors, ["deliver"]);
    assert.equal(pending[0].delay, 30_000);
    scheduler.stop();
    assert.equal(emailSendSchedulerEnabled({ NODE_ENV: "production", NEXT_PUBLIC_BASE_URL: "https://sendb.kr" }), true);
    assert.equal(emailSendSchedulerEnabled({ NODE_ENV: "production", NEXT_PUBLIC_BASE_URL: "https://port-next-sendb-dev.example" }), false);
    assert.equal(emailSendSchedulerEnabled({ NODE_ENV: "development", NEXT_PUBLIC_BASE_URL: "https://sendb.kr" }), false);
    assert.equal(emailSendSchedulerEnabled({ NODE_ENV: "production", EMAIL_SEND_SCHEDULER: "off", NEXT_PUBLIC_BASE_URL: "https://sendb.kr" }), false);
    assert.equal(emailSendSchedulerEnabled({ NODE_ENV: "production", REPLY_TEST_ASSUME_PRODUCTION: "1", DATABASE_URL: "postgresql://test@localhost/test" }), false);
});

test("방문 감사 작업이 오래 걸려도 예약 전송과 다음 회차는 계속하고 방문 작업은 겹치지 않는다", async () => {
    const pending: { callback: () => Promise<void>; delay: number }[] = [];
    let finish!: () => void;
    let visits = 0;
    let deliveries = 0;
    const scheduler = createEmailSendScheduler({
        prepare: async () => {},
        deliver: async () => { deliveries++; },
        acknowledgeVisits: () => { visits++; return new Promise<void>(resolve => { finish = resolve; }); },
        schedule: (callback, delay) => { pending.push({ callback, delay }); return {}; },
        cancel: () => {},
    });
    await pending.shift()!.callback();
    await pending.shift()!.callback();
    assert.equal(visits, 1);
    assert.equal(deliveries, 2);
    finish();
    scheduler.stop();
    await pending.shift()!.callback();
    assert.equal(visits, 1);
    assert.equal(deliveries, 2);
});
