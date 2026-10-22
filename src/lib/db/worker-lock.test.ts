import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerLockManager } from "./worker-lock";

test("lock sessions are bounded and duplicate rounds do not open a connection", async () => {
    let opened = 0, closed = 0;
    const locks = createWorkerLockManager(() => {
        opened++;
        return { tryLock: async () => true, close: async () => { closed++; } };
    }, 2);
    const a = await locks.acquire(1), b = await locks.acquire(2);
    assert.ok(a && b);
    assert.equal(await locks.acquire(1), null);
    let thirdAcquired = false;
    const pending = locks.acquire(3).then((lease) => { thirdAcquired = true; return lease; });
    await Promise.resolve();
    assert.equal(thirdAcquired, false);
    assert.equal(await locks.acquire(3), null);
    assert.equal(opened, 2);
    await Promise.all([a.release(), a.release()]);
    assert.equal(closed, 1);
    const c = await pending;
    assert.ok(c);
    await b.release(); await c.release();
    assert.equal(closed, 3);
});

test("other-instance contention and acquisition failures close sessions and free capacity", async () => {
    let mode = "busy", closed = 0;
    const locks = createWorkerLockManager(() => ({
        async tryLock() { if (mode === "error") throw new Error("connection failed"); return mode === "ok"; },
        async close() { closed++; },
    }), 1);
    assert.equal(await locks.acquire(1), null);
    mode = "error";
    await assert.rejects(locks.acquire(1), /connection failed/);
    mode = "ok";
    const lease = await locks.acquire(1);
    assert.ok(lease); await lease.release();
    assert.equal(closed, 3);
});

test("closing failure retains the capacity bound until close is retried successfully", async () => {
    let fail = true;
    const locks = createWorkerLockManager(() => ({
        tryLock: async () => true,
        close: async () => { if (fail) throw new Error("close failed"); },
    }), 1);
    const lease = await locks.acquire(1);
    await assert.rejects(lease!.release(), /close failed/);
    let nextAcquired = false;
    const pending = locks.acquire(2).then((next) => { nextAcquired = true; return next; });
    await Promise.resolve();
    assert.equal(nextAcquired, false);
    fail = false;
    await lease!.release();
    const next = await pending;
    assert.ok(next); await next.release();
});

test("waiting jobs get capacity before a new round of a frequent job", async () => {
    const acquired: number[] = [];
    const locks = createWorkerLockManager(() => ({
        async tryLock(key) { acquired.push(key); return true; },
        async close() {},
    }), 1);
    const first = await locks.acquire(1);
    const second = locks.acquire(2);
    const third = locks.acquire(3);
    await first!.release();
    const repeat = locks.acquire(1);
    const secondLease = await second;
    assert.deepEqual(acquired, [1, 2]);
    await secondLease!.release();
    const thirdLease = await third;
    assert.deepEqual(acquired, [1, 2, 3]);
    await thirdLease!.release();
    await (await repeat)!.release();
    assert.deepEqual(acquired, [1, 2, 3, 1]);
});
