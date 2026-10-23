import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { openQa, qaUrl } from "./email-stats/db-fixture.test-helper";
import { ensureSendLogIndexes } from "./db/send-log-indexes";
import { executedFullScans, planNodes, sqlLiteral, type PlanNode } from "./db/pglite-harness.test-helper";
import { fixtureEmail, fixtureNow, journeyTarget, legacyJourneyFacts } from "./customer-journey-audience-legacy.test-helper";
import { loadJourneyAudience } from "./customer-journey-audience";
import { audienceGuardsSql } from "./deep-visitor-alert-guards-sql";
import { guardInput, legacyAudienceGuardsSql } from "./deep-visitor-alert-guards-legacy.test-helper";

type Connection = Awaited<ReturnType<postgres.Sql["reserve"]>>;
interface Query { text: string; params: unknown[] }
interface Plan { Plan: PlanNode; "Execution Time": number }
const indexName = "records_workspace_email_norm_idx";
const truncate = "TRUNCATE records, email_send_logs, organizations RESTART IDENTITY CASCADE";
async function seed(c: postgres.Sql) {
    assert.equal((await c`SELECT current_database() AS name`)[0].name, "sendb_email_stats_qa");
    await c.unsafe(truncate);
    await c.unsafe(`INSERT INTO organizations(id,name,slug) VALUES ('00000000-0000-4000-8000-000000000001','QA journey','qa-journey');
        INSERT INTO workspaces(id,org_id,name) SELECT i,'00000000-0000-4000-8000-000000000001','QA '||i FROM generate_series(8,9) i;
        INSERT INTO partitions(id,workspace_id,name) VALUES (1,8,'QA'),(2,9,'QA');
        INSERT INTO records(id,org_id,workspace_id,partition_id,data)
        SELECT i,'00000000-0000-4000-8000-000000000001',CASE WHEN i<=100000 THEN 8 ELSE 9 END,
            CASE WHEN i<=100000 THEN 1 ELSE 2 END,
            jsonb_build_object('email',CASE WHEN i<=5 THEN 'kim@sample.co.kr' ELSE 'qa-'||i||'@fixture.test' END,
                'padding',repeat(md5(i::text),19)) FROM generate_series(1,120000) i;
        INSERT INTO tracker_sites(id,org_id,workspace_id,name,api_key) VALUES(2,'00000000-0000-4000-8000-000000000001',8,'QA','qa-journey');
        INSERT INTO tracker_visitors(id,org_id,site_id,visitor_id,record_id) VALUES(5,'00000000-0000-4000-8000-000000000001',2,'qa',2);
        INSERT INTO visitor_record_links(org_id,visitor_id,record_id) VALUES('00000000-0000-4000-8000-000000000001',5,3);
        INSERT INTO email_send_logs(id,org_id,record_id,recipient_email,subject,status,sent_at)
            VALUES(1,'00000000-0000-4000-8000-000000000001',1,'kim@sample.co.kr','QA','sent','2026-10-21T23:00:00Z');
        INSERT INTO email_click_logs(org_id,send_log_id,click_id,url) VALUES('00000000-0000-4000-8000-000000000001',1,'fixture-click','https://fixture.test');
        INSERT INTO tracker_sessions(id,site_id,visitor_id,session_key,click_id,started_at,ended_at,duration,page_count)
            VALUES(50,2,5,'qa','fixture-click','2026-10-21T23:30:00Z','2026-10-22T00:00:00Z',1800,2);
        INSERT INTO tracker_events(site_id,session_id,visitor_id,event_type,page_url,occurred_at)
            VALUES(2,50,5,'PAGE_VIEW','https://fixture.test/pricing','2026-10-21T23:31:00Z');
        INSERT INTO tracker_funnels(org_id,site_id,name,kind,is_default,stages)
            VALUES('00000000-0000-4000-8000-000000000001',2,'QA','marketing',1,'[{"match":{"type":"record_field","field":"stage","value":"converted"}}]');
        INSERT INTO record_events(org_id,record_id,type,label) VALUES('00000000-0000-4000-8000-000000000001',1,'signup','converted');
        ANALYZE records; ANALYZE workspaces; ANALYZE tracker_sites; ANALYZE tracker_visitors; ANALYZE tracker_sessions;
        ANALYZE email_send_logs; ANALYZE email_click_logs; ANALYZE visitor_record_links; ANALYZE record_events;`);
    assert.deepEqual([...await c`SELECT workspace_id, count(*)::int AS n FROM records GROUP BY workspace_id ORDER BY workspace_id`],
        [{ workspace_id: 8, n: 100000 }, { workspace_id: 9, n: 20000 }]);
}
async function explain(c: Connection, q: Query, mode: "generic" | "custom", label: string, t: TestContext): Promise<Plan> {
    await c.unsafe(`PREPARE qa_journey AS ${q.text}`);
    try {
        await c.unsafe(`SET plan_cache_mode = force_${mode}_plan`);
        const execute = `EXECUTE qa_journey(${q.params.map(sqlLiteral).join(",")})`;
        const result = await c.unsafe<{ "QUERY PLAN": Plan[] }[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${execute}`);
        t.diagnostic(`${label} ${mode} JSON: ${JSON.stringify(result[0]["QUERY PLAN"])}`);
        const text = await c.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${execute}`);
        t.diagnostic(`${label} ${mode} TEXT:\n${text.map(row => row["QUERY PLAN"]).join("\n")}`);
        return result[0]["QUERY PLAN"][0];
    } finally { await c.unsafe("DEALLOCATE qa_journey"); await c.unsafe("RESET plan_cache_mode"); }
}
function assertIndexed(plan: Plan) {
    assert.equal(executedFullScans(plan.Plan, "records").length, 0);
    assert.ok(planNodes(plan.Plan).some(n => n["Index Name"] === indexName && /"?left"?\(lower\(btrim\(/.test(n["Index Cond"] ?? "")));
    assert.equal(planNodes(plan.Plan).some(n => ["records_workspace_idx", "records_org_idx"].includes(n["Index Name"] ?? "")), false);
    assert.ok(plan["Execution Time"] < 1000, `Execution Time=${plan["Execution Time"]}ms`);
}
const url = qaUrl();
test("T12 B2/B11: local QA 120k records, concurrent index, actual driver and generic/custom plans", { skip: !url }, async t => {
    const c = await openQa();
    let captured: Query | undefined;
    const client = postgres(url!, { max: 1, onnotice: () => {}, debug: (_id, text, params) => { captured = { text, params: [...params] }; } });
    let conn: Connection | undefined;
    let canClean = false;
    try {
        assert.equal((await c`SELECT current_database() AS name`)[0].name, "sendb_email_stats_qa");
        canClean = true;
        await seed(c);
        t.diagnostic(JSON.stringify((await c`SELECT version() AS version`)[0]));
        await c.unsafe(`DROP INDEX IF EXISTS ${indexName}`);
        conn = await client.reserve();
        const target = journeyTarget(["email"]); target.recordId = 1;
        await legacyJourneyFacts(conn, target, fixtureNow);
        assert.ok(captured); const before: Query = captured;
        for (const mode of ["generic", "custom"] as const) await explain(conn, before, mode, "journey before", t);
        const input = guardInput(); input.itemRecordIds = [1]; input.specs = [{ workspaceId: 8, keys: ["email"], emails: [fixtureEmail] }];
        input.allEmails = [fixtureEmail]; input.unsubWorkspaceIds = [8];
        const dialect = new PgDialect();
        const oldGuard = dialect.sqlToQuery(legacyAudienceGuardsSql(input));
        await explain(conn, { text: oldGuard.sql, params: oldGuard.params }, "custom", "grec before", t);
        await ensureSendLogIndexes(url);
        assert.equal((await c`SELECT indisvalid FROM pg_index WHERE indexrelid = ${indexName}::regclass`)[0].indisvalid, true);
        t.diagnostic("B2: records_workspace_email_norm_idx indisvalid=true");
        await c.unsafe("ANALYZE records");
        let after: Query | undefined;
        for (let i = 0; i < 7; i++) {
            const start = performance.now();
            await loadJourneyAudience(conn, target, fixtureNow);
            const elapsed = performance.now() - start;
            after = captured;
            t.diagnostic(`journey actual driver call ${i + 1}: ${elapsed.toFixed(3)}ms`);
            assert.ok(elapsed < 1000);
        }
        assert.ok(after);
        for (const mode of ["generic", "custom"] as const) assertIndexed(await explain(conn, after, mode, "journey after", t));
        const guard = dialect.sqlToQuery(audienceGuardsSql(input));
        assertIndexed(await explain(conn, { text: guard.sql, params: guard.params }, "custom", "grec after", t));
    } finally {
        try { if (canClean) await c.unsafe(truncate); }
        finally { conn?.release(); await client.end(); await c.end(); }
    }
});
