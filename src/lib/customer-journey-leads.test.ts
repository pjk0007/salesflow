import { test } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "./auth-fake-db.test-helper";

type Row = { id: number; valid: boolean };

/** 정렬된 판정 줄 흉내 — after 뒤의 줄을 size만큼 준다 (커서 = 마지막 줄) */
function source(rows: Row[]) {
    const calls: Array<{ after: number | null; size: number }> = [];
    const fetchBatch = async (after: Row | null, size: number) => {
        calls.push({ after: after?.id ?? null, size });
        const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
        return rows.slice(start, start + size);
    };
    const accept = async (row: Row) => (row.valid ? row.id : null);
    return { fetchBatch, accept, calls };
}

const rows = (pattern: string) => [...pattern].map((c, i) => ({ id: i + 1, valid: c === "o" }));

async function load(t: Parameters<typeof isolateEnv>[0]) {
    isolateEnv(t);
    return import("./customer-journey-leads");
}

test("UX-214 첫 묶음이 전부 제외돼도 다음 묶음에서 유효 리드를 채운다", async (t) => {
    const { fillFromBatches } = await load(t);
    const s = source(rows("xxxxx" + "ooooo"));
    const r = await fillFromBatches(s.fetchBatch, s.accept, 3, { batchSize: 5 });
    assert.deepEqual(r.items, [6, 7, 8]);
    assert.deepEqual(s.calls, [{ after: null, size: 5 }, { after: 5, size: 5 }]);
});

test("UX-214 일부 제외: 순서를 지키며 한도까지 채우고 더 읽지 않는다", async (t) => {
    const { fillFromBatches } = await load(t);
    const s = source(rows("oxoxo" + "oxoxo"));
    const r = await fillFromBatches(s.fetchBatch, s.accept, 4, { batchSize: 5 });
    assert.deepEqual(r.items, [1, 3, 5, 6]);
    assert.equal(s.calls.length, 2);
    assert.equal(r.exhausted, false);
});

test("UX-214 모두 유효하면 첫 묶음 한 번으로 끝난다", async (t) => {
    const { fillFromBatches } = await load(t);
    const s = source(rows("oooooooooo"));
    const r = await fillFromBatches(s.fetchBatch, s.accept, 5, { batchSize: 5 });
    assert.deepEqual(r.items, [1, 2, 3, 4, 5]);
    assert.equal(s.calls.length, 1);
});

test("UX-214 다음 묶음이 없으면(덜 찬 묶음·빈 묶음) 멈추고 있는 만큼만 돌려준다", async (t) => {
    const { fillFromBatches } = await load(t);
    const short = source(rows("xxo"));
    const a = await fillFromBatches(short.fetchBatch, short.accept, 5, { batchSize: 5 });
    assert.deepEqual(a.items, [3]);
    assert.equal(a.exhausted, true);
    assert.equal(short.calls.length, 1);

    const exact = source(rows("xxxxx"));
    const b = await fillFromBatches(exact.fetchBatch, exact.accept, 5, { batchSize: 5 });
    assert.deepEqual(b.items, []);
    assert.equal(b.exhausted, true);
    assert.deepEqual(exact.calls.map((c) => c.after), [null, 5], "꽉 찬 묶음 뒤 빈 묶음을 한 번 확인하고 멈춘다");

    const none = source([]);
    assert.deepEqual((await fillFromBatches(none.fetchBatch, none.accept, 5)).items, []);
    assert.equal(none.calls.length, 1);
});

test("UX-214 실제 SQL(메모리 PGlite): 동률 시각·등급이 섞여도 커서로 모든 판정 줄을 한 번씩 정렬 순서대로 읽는다", async (t) => {
    const { listAssessedLeads } = await load(t);
    const { openPglite, pgliteTag, insertRow } = await import("./db/pglite-harness.test-helper");
    const { customerJourneyAlerts, workspaces, records } = await import("./db/schema");
    const pg = await openPglite([workspaces, records, customerJourneyAlerts]);
    t.after(() => pg.close());
    const org = "00000000-0000-4000-8000-0000000000aa";
    const now = new Date("2026-10-25T03:00:00Z");
    await insertRow(pg, "workspaces", { id: 1, org_id: org, name: "가상 사업" });
    const expected: Array<{ id: number; rank: number; at: string }> = [];
    for (let id = 1; id <= 120; id++) {
        await insertRow(pg, "records", { id, org_id: org, workspace_id: 1, partition_id: 1 });
        // 같은 시각이 여러 줄(동률) · 긴급/주목 섞임 · 마이크로초가 있는 시각
        const tier = id % 3 === 0 ? "urgent" : "highlight";
        const at = `2026-10-2${id % 4}T01:00:00.${String(100000 + (id % 5)).slice(1)}Z`;
        await insertRow(pg, "customer_journey_alerts", {
            id, org_id: org, workspace_id: 1, record_id: id, session_id: 1000 + id, stage: "둘러봄", status: "sent",
            last_activity_at: at, created_at: "2026-10-24T00:00:00Z",
            message: JSON.stringify({ journeyPriority: { version: 1, rankEligible: true, tier, customerKey: `c${id}` } }),
        });
        expected.push({ id, rank: tier === "urgent" ? 0 : 1, at });
    }
    expected.sort((a, b) => a.rank - b.rank || b.at.localeCompare(a.at) || b.id - a.id);
    const log: Array<{ text: string; rows: Record<string, unknown>[] }> = [];
    const tag = pgliteTag(pg, log as never);
    // 판정 줄 묶음만 실제 SQL로 돌린다. 재확인(loadCandidates)은 대상 없음 → 모두 제외되어 끝까지 이어 읽게 된다
    const conn = ((strings: TemplateStringsArray, ...params: unknown[]) =>
        strings[0].includes("WITH assessed") ? tag(strings, ...params) : Promise.resolve([])) as never;
    const leads = await listAssessedLeads(conn, { orgId: org, now, limit: 5, env: {} });
    assert.deepEqual(leads, []);
    const batches = log.map((q) => q.rows.map((r) => Number(r.id)));
    assert.deepEqual(batches.map((b) => b.length), [50, 50, 20]);
    assert.deepEqual(batches.flat(), expected.map((e) => e.id), "누락·중복 없이 정렬 순서 그대로");
});

test("UX-214 제외만 끝없이 이어져도 최대 확인 줄 수에서 멈춘다 (무한 조회 없음)", async (t) => {
    const { fillFromBatches, LEAD_MAX_SCANNED } = await load(t);
    let fetched = 0;
    const endless = async (_after: Row | null, size: number) => {
        fetched += size;
        return Array.from({ length: size }, (_, i) => ({ id: fetched - size + i + 1, valid: false }));
    };
    const r = await fillFromBatches(endless, async () => null, 10, { batchSize: 50 });
    assert.deepEqual(r.items, []);
    assert.equal(r.scanned, LEAD_MAX_SCANNED);
    assert.equal(fetched, LEAD_MAX_SCANNED);
    // 상한이 묶음 크기의 배수가 아니어도 넘지 않는다
    const odd = source(rows("x".repeat(30)));
    const o = await fillFromBatches(odd.fetchBatch, odd.accept, 3, { batchSize: 7, maxScanned: 10 });
    assert.equal(o.scanned, 10);
    assert.deepEqual(odd.calls.map((c) => c.size), [7, 3]);
});
