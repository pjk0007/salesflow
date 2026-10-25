/**
 * UX-197: 한 시간 창의 결과 쪽이 회차 몫보다 많아도 커서가 앞으로 나간다 — 가상 NHN(창 길이에 비례한 쪽 수)과 가상 db로 확인.
 * 실제 NHN·DB는 부르지 않는다.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-25T03:00:00Z");
const kst = (s: string) => Date.parse(`${s.replace(" ", "T")}+09:00`);

async function fixture(t: TestContext, perMinute: number) {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const cursors: number[] = [];
    installFakeDb(t, db, (c) => {
        if (c.op !== "execute") return [];
        if (c.sql.includes("FROM email_configs")) return [{ org_id: orgId, app_key: "app", secret_key: "secret" }];
        if (c.sql.includes("INSERT INTO email_status_sync_state")) {
            const iso = c.params.find((p) => typeof p === "string" && /^\d{4}-\d\d-\d\dT/.test(p)) as string;
            cursors.push(Date.parse(iso));
        }
        return [];
    });
    const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
    t.mock.method(queryClient, "reserve", async () => connection as never);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
        calls++;
        const q = new URL(url).searchParams;
        const minutes = (kst(q.get("endMailStatusUpdateDate")!) - kst(q.get("startMailStatusUpdateDate")!)) / 60_000;
        const totalCount = Math.round(minutes * perMinute);
        const pageNum = Number(q.get("pageNum")), pageSize = Number(q.get("pageSize"));
        const n = Math.max(0, Math.min(pageSize, totalCount - (pageNum - 1) * pageSize));
        const data = Array.from({ length: n }, (_, i) => ({ requestId: `r-${pageNum}-${i}`, mailStatusCode: "SST2" }));
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "" }, body: { data, totalCount } });
    });
    const { syncOrgStatuses } = await import("./email-status-sync");
    const env = { NHN_STATUS_PAGE_SIZE: "10", NHN_STATUS_FALLBACK_CALLS: "0", NHN_STATUS_BACKFILL_DAYS: "0" };
    return { run: (maxCalls: number) => syncOrgStatuses(orgId, { env, now: NOW, maxCalls }), cursors, calls: () => calls };
}

test("UX-197: 창의 쪽 수(13쪽)가 회차 예산(6회)보다 많아도 창을 줄여 커서를 옮긴다", async (t) => {
    const f = await fixture(t, 2); // 65분 창(겹침 5분 포함) × 분당 2건 = 130건 = 13쪽
    const stats = await f.run(6);
    assert(stats);
    assert(f.calls() <= 6, `예산 안에서만 묻는다 (calls=${f.calls()})`);
    const initial = NOW.getTime() - 60 * 60_000;
    assert(f.cursors.length > 0, "커서를 저장했다");
    assert(Math.max(...f.cursors) > initial, "커서가 처음 자리보다 앞으로 나갔다");
    assert(stats.windows >= 1);
});

test("UX-197: 예산 안에 드는 창은 예전처럼 한 번에 읽는다 (창을 줄이지 않는다)", async (t) => {
    const f = await fixture(t, 0.1); // 65분 × 0.1 = 7건 = 1쪽
    const stats = await f.run(6);
    assert(stats);
    assert.equal(f.calls(), 1);
    assert.equal(Math.max(...f.cursors), NOW.getTime() - 60_000, "now − 1분까지 한 창으로 따라잡는다");
});

test("UX-260: NHN 키가 틀리면(401) 동기화 결과에 키 오류를 싣는다 — 화면이 성공 대신 경고를 보인다", async (t) => {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    installFakeDb(t, db, (c) => (c.op === "execute" && c.sql.includes("FROM email_configs") ? [{ org_id: orgId, app_key: "app", secret_key: "bad" }] : []));
    t.mock.method(queryClient, "reserve", async () => Object.assign(async () => [{ acquired: true }], { release() {} }) as never);
    t.mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));
    const { syncOrgStatuses } = await import("./email-status-sync");
    const { syncWarning } = await import("./email-status-sync-rules");
    const stats = await syncOrgStatuses(orgId, { now: NOW, maxCalls: 5, env: { NHN_STATUS_FALLBACK_CALLS: "0", NHN_STATUS_BACKFILL_DAYS: "0" } });
    assert(stats);
    assert.equal(stats.updated, 0);
    assert.equal(stats.lastFailure?.kind, "auth");
    assert.match(syncWarning(stats)!, /appKey·secretKey/);
});
