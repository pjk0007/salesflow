/* eslint-disable @typescript-eslint/no-require-imports -- isolated in-memory PostgreSQL fixtures */
// node --import tsx scripts/check-email-unsubscribes.cjs
// No environment file, external database, credentials or send transport is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { drizzle } = require("drizzle-orm/pglite");
const { PgDialect, getTableConfig } = require("drizzle-orm/pg-core");
const { SQL } = require("drizzle-orm");
const schema = require("../src/lib/db/schema.ts");
const { createEmailUnsubscribeStore, unsubscribedRecipientsQuery } = require("../src/lib/email-unsubscribe-store.ts");
const { loadJourneyAudience } = require("../src/lib/customer-journey-audience.ts");
const { EMAIL_TRIM_CHARS } = require("../src/lib/deep-visitor-alert-rules.ts");
const org = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const dialect = new PgDialect();
function ddl(table) {
    const config = getTableConfig(table);
    const literal = (v) => typeof v === "boolean" || typeof v === "number" ? String(v)
        : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
    return `CREATE TABLE "${config.name}" (${config.columns.map((c) =>
        `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${c.default === undefined ? "" : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : literal(c.default)}`}`,
    ).join(",")});`;
}

async function main() {
    const pg = new PGlite();
    await pg.waitReady;
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("No external network in unsubscribe regression tests"); };
    try {
        // Apply the real historical migration, then seed pre-existing opt-outs before the upgrade.
        for (const table of [schema.organizations, schema.workspaces, schema.partitions, schema.emailSendLogs,
            schema.emailTemplates, schema.emailAutoPersonalizedLinks]) await pg.exec(ddl(table));
        await pg.exec(fs.readFileSync(path.join(__dirname, "../drizzle/0060_email_unsubscribe.sql"), "utf8"));
        await pg.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'가상 계정 A','test-a'),($2,'가상 계정 B','test-b')", [org, other]);
        await pg.query("INSERT INTO workspaces (id,org_id,name) VALUES (1,$1,'가상 백오피스랩'),(2,$1,'가상 오피오'),(3,$2,'독립 계정')", [org, other]);
        await pg.query("INSERT INTO email_unsubscribes (org_id,workspace_id,email,reason,source) VALUES ($1,1,$3,'first source','link'),($1,2,$4,'historical duplicate','one_click'),($2,3,'only-other@example.test','other account','manual')",
            [org, other, "\t Shared@Example.TEST　", "shared@example.test"]);
        const before = (await pg.query("SELECT * FROM email_unsubscribes ORDER BY id")).rows;
        const migration = fs.readFileSync(path.join(__dirname, "../drizzle/0123_organization_email_unsubscribe.sql"), "utf8");
        await pg.exec(migration);
        assert.deepEqual((await pg.query("SELECT * FROM email_unsubscribes ORDER BY id")).rows, before, "upgrade preserves all historical source rows");
        await pg.exec(migration); // A recoverable re-run remains non-destructive.
        const db = drizzle(pg, { schema });
        const store = createEmailUnsubscribeStore(db);
        assert.equal(await store.isUnsubscribed(2, "SHARED@example.test\n"), true, "old opt-out blocks other workspace");
        assert.equal(await store.isOrganizationUnsubscribed(org, "only-other@example.test"), false, "other organization remains isolated");
        assert.equal(await store.isUnsubscribed(3, "shared@example.test"), false, "same email is not a system-wide block");
        await assert.rejects(() => store.isUnsubscribed(999, "shared@example.test"), /사업 정보/, "unknown ownership fails closed");

        // Preflight uses the same SQL normalization and returns original strings for cached queue lookup.
        const input = [...EMAIL_TRIM_CHARS].map((ch) => `${ch}Shared@Example.TEST${ch}`);
        const batch = await db.execute(unsubscribedRecipientsQuery(org, [...input, "only-other@example.test", "safe@example.test"]));
        assert.deepEqual(batch.rows.map((r) => input[r.ordinal]), input);
        await pg.query("DELETE FROM workspaces WHERE id=1");
        assert.equal((await pg.query("SELECT workspace_id FROM email_unsubscribes WHERE id=1")).rows[0].workspace_id, null);
        assert.equal(await store.isUnsubscribed(2, "shared@example.test"), true, "source workspace deletion cannot re-enable address");

        await store.recordUnsubscribe({ orgId: org, workspaceId: null, email: " MANUAL@example.test ", source: "manual" });
        await Promise.all([
            store.recordUnsubscribe({ orgId: org, workspaceId: null, email: "manual@example.test", source: "manual" }),
            store.recordUnsubscribe({ orgId: org, workspaceId: 2, email: "MANUAL@example.test", source: "one_click" }),
        ]);
        assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM email_unsubscribes WHERE email='manual@example.test'")).rows[0].n, 1, "repeat and cross-workspace additions are idempotent");
        await assert.rejects(() => store.recordUnsubscribe({ orgId: org, workspaceId: 3, email: "wrong@example.test" }), /계정 정보/);

        // Tokens without a live partition still identify their owning organization.
        await pg.query("INSERT INTO email_send_logs (org_id,recipient_email,subject,unsubscribe_token) VALUES ($1,'token@example.test','가상 메일','unsub_fixture')", [org]);
        const target = await store.resolveUnsubscribeTarget("unsub_fixture");
        assert.equal(target.workspaceId, null);
        assert.equal(target.orgId, org);
        await store.recordUnsubscribe(target);
        assert.equal((await store.resolveUnsubscribeTarget("unsub_fixture")).alreadyUnsubscribed, true);
        assert.equal(await store.attachUnsubscribeReason("unsub_fixture", "가상 수신거부 사유"), true);
        assert.equal(await store.resolveUnsubscribeTarget("invalid-token"), null);
        assert.equal(await store.attachUnsubscribeReason("invalid-token", "ignored"), false);

        // Exercise the actual journey SQL guard with virtual data from another workspace.
        for (const table of [schema.users, schema.organizationMembers, schema.emailSenderProfiles, schema.records,
            schema.trackerSites, schema.trackerSessions, schema.trackerVisitors, schema.visitorRecordLinks,
            schema.emailClickLogs, schema.trackerFunnels, schema.recordEvents, schema.trackerEvents]) await pg.exec(ddl(table));
        await pg.query("INSERT INTO tracker_sites (id,org_id,workspace_id,name,domains,api_key) VALUES (1,$1,2,'가상 사이트','[\"example.test\"]','test-key')", [org]);
        const now = new Date("2026-10-23T00:00:00Z");
        const session = { id: 1, siteId: 1, visitorId: 1, startedAt: now, endedAt: now, duration: 0, pageCount: 1, clickId: null };
        const conn = async (strings, ...params) => (await pg.query(strings.reduce((s, p, i) => s + p + (i < params.length ? `$${i + 1}` : ""), ""), params)).rows;
        const audience = await loadJourneyAudience(conn, { orgId: org, workspaceId: 2, recordId: 1, recipientEmail: "shared@example.test", sentAt: now, session, fields: [] }, now);
        assert.equal(audience.unsubscribed, true, "journey SQL respects cross-workspace historical opt-out");
        const clean = await loadJourneyAudience(conn, { orgId: org, workspaceId: 2, recordId: 1, recipientEmail: "only-other@example.test", sentAt: now, session, fields: [] }, now);
        assert.equal(clean.unsubscribed, false, "journey SQL preserves organization boundary");
        console.log("PASS: historical upgrade, account isolation, whitespace/case, queue preflight, workspace deletion, repeat registration, token resolution, journey guard (virtual PGlite only)");
    } finally {
        global.fetch = originalFetch;
        await pg.close();
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
