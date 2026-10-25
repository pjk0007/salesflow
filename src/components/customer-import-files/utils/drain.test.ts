// UX-095 — 첨부 일괄 가져오기가 현재 페이지 100개가 아니라 대기 파일 전체를 처리하는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drainPendingFiles } from "./drain";

type Row = { id: string; ok: boolean; big?: boolean };
/** 서버의 state=pending 목록처럼 동작: 성공한 파일은 대기에서 빠지고, 실패(예: 409)는 그대로 남는다. */
function fakeServer(total: number, failing: Set<string>) {
    const pending: Row[] = Array.from({ length: total }, (_, i) => ({ id: `f${i}`, ok: !failing.has(`f${i}`), big: i === 7 }));
    const fetched: string[] = [];
    return {
        fetched,
        page: async (offset: number) => ({ rows: pending.slice(offset, offset + 100), hasMore: offset + 100 < pending.length }),
        fetch: async (row: Row) => {
            fetched.push(row.id);
            if (!row.ok) throw new Error("가상 실패");
            pending.splice(pending.findIndex((r) => r.id === row.id), 1);
        },
        left: () => pending.map((r) => r.id),
    };
}

test("UX-095 대기 파일 250개를 페이지 경계를 넘어 모두 한 번씩 처리한다", async () => {
    const failing = new Set(["f3", "f150", "f249"]);
    const server = fakeServer(250, failing);
    const result = await drainPendingFiles({ page: server.page, fetch: server.fetch, eligible: (r) => !r.big, stopped: () => false });
    // 20MB 초과(f7)는 건너뛰고, 실패 파일도 다시 시도하지 않는다
    assert.equal(new Set(server.fetched).size, server.fetched.length);
    assert.equal(server.fetched.length, 249);
    assert.deepEqual(result, { done: 249, failed: 3 });
    assert.deepEqual(server.left().sort(), ["f150", "f249", "f3", "f7"]);
});

test("UX-095 중지하면 현재 파일 뒤 더 처리하지 않는다", async () => {
    const server = fakeServer(30, new Set());
    let stop = false;
    const result = await drainPendingFiles({
        page: server.page,
        fetch: async (row) => {
            await server.fetch(row);
            if (server.fetched.length === 5) stop = true;
        },
        eligible: () => true,
        stopped: () => stop,
    });
    assert.equal(result.done, 5);
    assert.equal(server.left().length, 25);
});

test("UX-095 모든 대기 파일이 계속 실패해도 끝난다", async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `f${i}`);
    const server = fakeServer(230, new Set(ids));
    const result = await drainPendingFiles({ page: server.page, fetch: server.fetch, eligible: () => true, stopped: () => false });
    assert.deepEqual(result, { done: 230, failed: 230 });
});
