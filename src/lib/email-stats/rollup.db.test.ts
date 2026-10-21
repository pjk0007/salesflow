import type postgres from "postgres";
import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { ALL_DAYS, fixture, openQa, qaUrl } from "./db-fixture.test-helper";
import { referenceSql } from "./reference-sql";
const url = qaUrl();
test("B2~B6: QA 귀속·집계·멱등·취소·리드·records 대조", { skip: !url }, async t => {
    const c = await openQa();
    try {
        const { fillAttribution } = await import("./attribution-store");
        const { recomputeRange } = await import("./rollup");
        const { acceptedSendConditionSql } = await import("../email-send-log-status");
        const orgs = await fixture(c);
        await t.test("D1: 범위 밖 부모를 보충하고 원본 사슬과 귀속이 같다", async () => {
            for (const org of orgs) {
                await fillAttribution(c, org.orgId, { from: "2026-10-18", to: "2026-10-21" });
                await fillAttribution(c, org.orgId, ALL_DAYS);
                const actual = await c`SELECT send_log_id,root_log_id,step_index,campaign_kind,campaign_id FROM email_stats_send_attr WHERE org_id=${org.orgId} ORDER BY send_log_id`;
                const expected = await c`WITH RECURSIVE chain AS (SELECT id start_id,id,parent_log_id,org_id,0 depth FROM email_send_logs WHERE org_id=${org.orgId} UNION ALL SELECT c.start_id,p.id,p.parent_log_id,p.org_id,c.depth+1 FROM chain c JOIN email_send_logs p ON p.id=c.parent_log_id AND p.org_id=c.org_id WHERE c.depth<10) SELECT DISTINCT ON(start_id) start_id send_log_id,c.id root_log_id,depth step_index,CASE WHEN r.auto_personalized_link_id IS NOT NULL THEN 'ai' WHEN r.template_link_id IS NOT NULL THEN 'template' ELSE 'manual' END campaign_kind,COALESCE(r.auto_personalized_link_id,r.template_link_id,r.email_template_id,0) campaign_id FROM chain c JOIN email_send_logs r ON r.id=c.id ORDER BY start_id,depth DESC`;
                assert.deepEqual([...actual], [...expected]);
            }
        });
        await t.test("D2: 원본과 모든 grain·날짜·25칸 일치하고 합계 불변식", async () => {
            for (const org of orgs) {
                await recomputeRange(c, org.orgId, ALL_DAYS);
                const q = new PgDialect().sqlToQuery(referenceSql(org.orgId, ALL_DAYS, acceptedSendConditionSql()));
                const reference = await c.unsafe(q.sql, q.params as postgres.ParameterOrJSON<never>[]);
                const actual = await c`SELECT * FROM email_stats_daily WHERE org_id=${org.orgId}`;
                const normalize = (rows: typeof actual) => rows.map(({ org_id: orgId, updated_at: updatedAt, ...row }) => { void orgId; void updatedAt; return JSON.stringify(Object.entries(row).sort()); }).sort();
                assert.deepEqual(normalize(actual), normalize(reference));
                const sums = await c`SELECT grain,sum(total)::int total FROM email_stats_daily WHERE org_id=${org.orgId} GROUP BY grain`;
                assert.equal(sums.length, 5); assert.ok(sums.every(s => s.total === 15));
                const countKeys = Object.keys(actual[0]).filter(key => !["org_id", "grain", "stat_date", "workspace_id", "campaign_kind", "campaign_id", "step_index", "partition_id", "sender_profile_id", "sender_domain", "trigger_type", "updated_at"].includes(key));
                assert.equal(countKeys.length, 25);
                for (const total of actual.filter(row => row.grain === "total")) {
                    for (const grain of ["campaign", "partition", "sender", "trigger"]) {
                        const parts = actual.filter(row => row.grain === grain && row.stat_date.getTime() === total.stat_date.getTime() && row.workspace_id === total.workspace_id);
                        for (const key of countKeys) assert.equal(parts.reduce((sum, row) => sum + Number(row[key]), 0), total[key], `${grain}/${key}`);
                    }
                }
                assert.equal((await c`SELECT sum(total)::int n FROM home_stats_daily WHERE org_id=${org.orgId}`)[0].n, 1);
            }
        });
        await t.test("D3: 같은 범위는 귀속 삽입·변경·삭제 모두 0", async () => {
            assert.deepEqual(await recomputeRange(c, orgs[0].orgId, ALL_DAYS), { attrInserted: 0, written: 0, deleted: 0 });
        });
        await t.test("D6: 취소된 후속만 있던 campaign 단계는 삭제", async () => {
            const org = orgs[0];
            await c`UPDATE email_send_logs SET status='cancelled' WHERE id=${org.ids[4]}`;
            const result = await recomputeRange(c, org.orgId, ALL_DAYS);
            assert.ok(result.deleted > 0);
            assert.equal((await c`SELECT count(*)::int n FROM email_stats_daily WHERE org_id=${org.orgId} AND grain='campaign' AND step_index=4`)[0].n, 0);
        });
        await t.test("D9: 리드 고객 키 중복은 합쳐지고 urgent 우선, skipped 제외", async () => {
            const leads = await c`SELECT org_id,tier,customer_key FROM email_stats_lead_days ORDER BY org_id`;
            assert.equal(leads.length, 2); assert.ok(leads.every(r => r.tier === "urgent" && r.customer_key === "a".repeat(64)));
        });
    } finally {
        const { queryClient } = await import("../db"); await queryClient.end(); await c.end();
    }
});
