import type postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { referenceSql } from "./reference-sql";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, openQa, qaUrl, NOW, ALL_DAYS, addEvents } from "./db-fixture.test-helper";
import { SEND_LOG_INDEXES } from "../db/send-log-indexes";
const url = qaUrl();
test("B7~B10: QA 워커 최근·야간·워터마크·백필·잠금·records 준비", { skip: !url }, async t => {
    const c = await openQa();
    try {
        const { runEmailStats } = await import("./worker");
        const { recomputeRange } = await import("./rollup");
        const { acceptedSendConditionSql } = await import("../email-send-log-status");
        const orgs = (await fixture(c)).sort((a, b) => a.orgId.localeCompare(b.orgId)), org = orgs[0];
        for (const index of SEND_LOG_INDEXES) if (index.name !== "records_org_created_at_idx") await c.unsafe(index.ddl);
        await c.unsafe("DROP INDEX IF EXISTS records_org_created_at_idx");
        await t.test("records 미준비: 이메일 최근만 계산하고 공통 커서·워터마크를 보존", async () => {
            await c`INSERT INTO email_stats_state(org_id,first_send_date,filled_from,nightly_date,nightly_next,wm_open_id,wm_click_id,wm_reply_id,wm_unsub_id,wm_complaint_id) VALUES(${org.orgId},'2026-09-01','2026-10-01','2026-10-19','2026-10-10',1,2,3,4,5)`;
            const before = await c`SELECT first_send_date,filled_from,backfill_done_at,nightly_date,nightly_next,wm_open_id,wm_click_id,wm_reply_id,wm_unsub_id,wm_complaint_id FROM email_stats_state WHERE org_id=${org.orgId}`;
            const result = await runEmailStats({ now: NOW, force: "nightly" });
            assert.equal(result.recordsSkipped, "index_pending"); assert.equal(result.errors, 0); assert.ok(result.recent.written > 0);
            assert.deepEqual([...await c`SELECT first_send_date,filled_from,backfill_done_at,nightly_date,nightly_next,wm_open_id,wm_click_id,wm_reply_id,wm_unsub_id,wm_complaint_id FROM email_stats_state WHERE org_id=${org.orgId}`], [...before]);
            assert.equal((await c`SELECT count(*)::int n FROM home_stats_daily`)[0].n, 0);
            assert.ok((await c`SELECT recent_done_at FROM email_stats_state WHERE org_id=${org.orgId}`)[0].recent_done_at);
        });
        await c.unsafe(SEND_LOG_INDEXES.find(index => index.name === "records_org_created_at_idx")!.ddl);
        await c`DELETE FROM email_stats_state`;
        await t.test("D7: 예산0은 한 조각 후 멈추고 다음 회차에서 이어 완료", async () => {
            const first = await runEmailStats({ now: NOW, budgetMs: 0 }); assert.equal(first.errors, 0); assert.equal(first.backfill.days, 2);
            assert.equal((await c`SELECT first_send_date::text d FROM email_stats_state WHERE org_id=${org.orgId}`)[0].d, "2026-08-01");
            const cursor = (await c`SELECT filled_from::text d FROM email_stats_state WHERE org_id=${org.orgId}`)[0].d;
            assert.equal(cursor, "2026-10-12");
            const resumed = await runEmailStats({ now: new Date("2026-10-21T10:00:00Z"), budgetMs: 120000 });
            assert.equal(resumed.errors, 0);
            assert.ok((await c`SELECT backfill_done_at FROM email_stats_state`).every(s => s.backfill_done_at));
            assert.equal((await c`SELECT sum(total)::int n FROM home_stats_daily`)[0].n, 3);
        });
        const snapshot = async (date: string) => JSON.stringify([...await c`SELECT * FROM email_stats_daily WHERE org_id=${org.orgId} AND stat_date=${date} ORDER BY grain,campaign_id,step_index`]);
        const assertMatches = async (date: string) => {
            const q = new PgDialect().sqlToQuery(referenceSql(org.orgId, { from: date, to: date }, acceptedSendConditionSql()));
            const expected = await c.unsafe(q.sql, q.params as postgres.ParameterOrJSON<never>[]);
            const actual = await c`SELECT * FROM email_stats_daily WHERE org_id=${org.orgId} AND stat_date=${date}`;
            const normalize = (rows: typeof actual) => rows.map(({ org_id: orgId, updated_at: updatedAt, ...row }) => { void orgId; void updatedAt; return JSON.stringify(Object.entries(row).sort()); }).sort();
            assert.deepEqual(normalize(actual), normalize(expected));
            assert.deepEqual(await recomputeRange(c, org.orgId, { from: date, to: date }), { attrInserted: 0, written: 0, deleted: 0 });
        };
        await t.test("D4: 최근 변경은 다음 회차, 20일 전은 다음 야간에 반영", async () => {
            const old = await snapshot(org.dates[1]);
            await addEvents(c, org, org.ids[2]); await addEvents(c, org, org.ids[1]);
            await c`UPDATE email_send_logs SET status='failed',nhn_status_code='SST3',delivery_status_code='5.1.1' WHERE id=${org.ids[2]}`;
            assert.equal((await runEmailStats({ now: NOW })).errors, 0);
            await assertMatches(org.dates[2]); assert.equal(await snapshot(org.dates[1]), old);
            assert.equal((await runEmailStats({ now: new Date("2026-10-21T16:30:00Z") })).errors, 0);
            assert.notEqual(await snapshot(org.dates[1]), old); await assertMatches(org.dates[1]);
        });
        await t.test("D5: 50일 전 늦은 이벤트는 그 날짜만 다시 쓴다", async () => {
            const untouched = await snapshot(org.dates[5]);
            await addEvents(c, org, org.ids[0]);
            const result = await runEmailStats({ now: new Date("2026-10-22T16:30:00Z") }); assert.equal(result.errors, 0); assert.ok(result.nightly.lateDays > 0);
            await assertMatches(org.dates[0]); assert.equal(await snapshot(org.dates[5]), untouched);
        });
        await t.test("D8: 동시 회차 중 하나만 잠금을 얻는다", async () => {
            const results = await Promise.all([runEmailStats({ now: NOW }), runEmailStats({ now: NOW })]);
            assert.equal(results.filter(r => r.skipped === "locked").length, 1);
            assert.ok(results.every(r => r.errors === 0));
        });
        await t.test("B26: 이메일 설정 없는 조직의 records도 날짜별 집계", async () => {
            assert.equal((await c`SELECT count(*)::int n FROM email_configs`)[0].n, 0);
            assert.equal((await c`SELECT count(DISTINCT org_id)::int n FROM home_stats_daily`)[0].n, 3);
            for (const o of orgs) await recomputeRange(c, o.orgId, ALL_DAYS);
        });
    } finally { const { queryClient } = await import("../db"); await queryClient.end(); await c.end(); }
});
