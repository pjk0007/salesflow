import test from "node:test";
import assert from "node:assert/strict";
import { fixture, openQa, qaUrl, NOW, ALL_DAYS } from "./db-fixture.test-helper";
import { SEND_LOG_INDEXES } from "../db/send-log-indexes";

const url = qaUrl();
test("B11·B12·B15·B31: QA 읽기 API와 수동 갱신", { skip: !url }, async (t) => {
    const c = await openQa();
    try {
        const { refreshStats } = await import("./refresh-store");
        const { readKpi } = await import("./read-kpi");
        const { readTrend, readCompare } = await import("./read-series");
        const { recomputeRange } = await import("./rollup");
        const orgs = await fixture(c);
        const org = orgs[0];
        const { ensureState, watermarks } = await import("./state");
        await t.test("records 미준비 최초 state도 모든 워터마크를 max(id)로 시드", async () => {
            const seeded = await ensureState(c, orgs[2].orgId, false);
            const expected = await watermarks(c, orgs[2].orgId);
            for (const key of Object.keys(expected) as Array<keyof typeof expected>) assert.equal(seeded[key], expected[key]);
            assert.equal(seeded.first_send_date, null);
        });
        for (const index of SEND_LOG_INDEXES) await c.unsafe(index.ddl);
        await c.unsafe("DROP INDEX records_org_created_at_idx");
        await t.test("B31: 색인 미준비 503은 쿨다운을 기록하지 않는다", async () => {
            assert.deepEqual(await refreshStats(org.orgId, NOW), {
                status: 503, body: { success: false, error: "집계 준비 중입니다. 잠시 뒤 다시 눌러 주세요." },
            });
            assert.equal((await c`SELECT count(*)::int n FROM email_stats_state WHERE org_id=${org.orgId} AND manual_refreshed_at IS NOT NULL`)[0].n, 0);
        });
        await c.unsafe(SEND_LOG_INDEXES.find((index) => index.name === "records_org_created_at_idx")!.ddl);
        await t.test("B31: 성공 후 429, 잠금 중에는 202", async () => {
            assert.equal((await refreshStats(org.orgId, NOW)).status, 200);
            const expected = await watermarks(c, org.orgId);
            const seeded = await ensureState(c, org.orgId, true);
            for (const key of Object.keys(expected) as Array<keyof typeof expected>) assert.equal(seeded[key], expected[key]);
            assert.equal((await refreshStats(org.orgId, NOW)).status, 429);
            await c`SELECT pg_advisory_lock(${0x5c4edf18})`;
            try { assert.equal((await refreshStats(orgs[1].orgId, NOW)).status, 202); }
            finally { await c`SELECT pg_advisory_unlock(${0x5c4edf18})`; }
        });
        for (const item of orgs) await recomputeRange(c, item.orgId, ALL_DAYS);
        await c`UPDATE email_stats_state SET filled_from='2026-08-01', backfill_done_at=${NOW}, recent_done_at=${NOW} WHERE org_id=${org.orgId}`;
        const query = { from: "2026-09-22", to: "2026-10-21", days: 30, workspaceId: null };
        await t.test("B12: KPI·추세·비교 합계 일치와 7개 축", async () => {
            const kpi = await readKpi(org.orgId, query);
            const trend = await readTrend(org.orgId, query, NOW);
            assert.equal(trend.points.length, 30);
            assert.equal(trend.points.reduce((sum, point) => sum + point.counts.accepted, 0), kpi.current.accepted);
            for (const axis of ["campaign", "step", "partition", "sender", "domain", "trigger", "date"] as const) {
                const compare = await readCompare(org.orgId, query, axis);
                assert.equal(compare.total.counts.accepted, kpi.current.accepted);
                assert.equal(compare.rows.reduce((sum, row) => sum + row.counts.accepted, 0), kpi.current.accepted);
            }
            assert.equal((await readKpi(org.orgId, { ...query, workspaceId: orgs[1].workspaceId })).current.total, 0);
        });
        await t.test("B26: 홈 집계가 KPI·일별 원천 합과 일치한다", async () => {
            const { homeSummary, homeTrends, homeTemplates } = await import("./home");
            const kpi = await readKpi(org.orgId, query);
            const summary = await homeSummary(org.orgId, query);
            assert.equal(summary.email.total, kpi.current.total);
            assert.equal(summary.triggerBreakdown.reduce((sum, row) => sum + row.total, 0), kpi.current.total);
            assert.equal((await homeTrends(org.orgId, query)).reduce((sum, row) => sum + row.sent, 0), kpi.current.sent);
            const [records] = await c`SELECT count(*)::int n FROM records WHERE org_id=${org.orgId} AND created_at >= '2026-09-22T00:00:00+09:00' AND created_at < '2026-10-22T00:00:00+09:00'`;
            assert.equal(summary.newRecordsInPeriod, records.n);
            const templates = await homeTemplates(org.orgId, query);
            assert.ok(templates.every(row => row.type === "ai_auto" || row.type === "link"));
            assert.ok(templates.length > 0);
        });
    } finally {
        const { queryClient } = await import("../db");
        await queryClient.end();
        await c.end();
    }
});
