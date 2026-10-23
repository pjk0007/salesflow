import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { audienceGuardsSql, type AudienceGuardsRow } from "./deep-visitor-alert-guards-sql";
import { guardFixture, guardInput, guardLongEmail, legacyAudienceGuardsSql } from "./deep-visitor-alert-guards-legacy.test-helper";
import { canonical } from "./customer-journey-audience-legacy.test-helper";

const dialect = new PgDialect();
test("T10: guards preserve workspace/email pairs, ordering, isolation and funnel events", async () => {
    const pg = await guardFixture();
    try {
        for (const variant of ["pairs", "no-keys", "no-visitors", "long", "no-stages"] as const) {
            const input = guardInput();
            if (variant === "no-keys") input.specs[0].keys = [];
            if (variant === "no-visitors") input.visitorIds = [];
            if (variant === "long") input.specs[0].emails = [guardLongEmail];
            if (variant === "no-stages") input.allStageValues = [];
            const old = dialect.sqlToQuery(legacyAudienceGuardsSql(input));
            const next = dialect.sqlToQuery(audienceGuardsSql(input));
            const expected = (await pg.query<AudienceGuardsRow>(old.sql, old.params)).rows[0];
            const actual = (await pg.query<AudienceGuardsRow>(next.sql, next.params)).rows[0];
            assert.deepEqual(actual.records, expected.records, variant);
            assert.deepEqual(actual.linked, expected.linked, variant);
            assert.deepEqual(canonical(actual.unsub), canonical(expected.unsub), variant);
            assert.deepEqual(canonical(actual.funnel_events), canonical(expected.funnel_events), variant);
            if (variant === "pairs") {
                assert.deepEqual(actual.records?.filter(r => r.email_match).map(r => r.id), [1, 4, 6]);
                assert.deepEqual(actual.linked?.map(r => r.record_id), [23, 24]);
                assert.equal(actual.funnel_events?.length, 2);
            }
            assert.equal(actual.records?.some(r => r.id === 5), false);
            if (variant === "long") assert.deepEqual(actual.records?.filter(r => r.email_match).map(r => r.id), [4, 7]);
            if (variant === "no-stages") assert.deepEqual(actual.funnel_events, []);
        }
    } finally { await pg.close(); }
});

import { createRecordEmailIndex, explainPrepared, executedFullScans, planNodes } from "./db/pglite-harness.test-helper";
test("T11: guards expression index and full-scan gates (custom)", async t => {
    const pg = await guardFixture();
    try {
        await createRecordEmailIndex(pg);
        for (const hasOtherKeys of [false, true]) {
            const input = guardInput();
            input.specs[1].keys = hasOtherKeys ? ["email", "work_email"] : ["email"];
            const q = dialect.sqlToQuery(audienceGuardsSql(input));
            const plan = await explainPrepared(pg, { text: q.sql, params: q.params }, { mode: "custom", analyze: true });
            t.diagnostic(`others=${hasOtherKeys}: ${JSON.stringify(plan)}`);
            assert.ok(planNodes(plan).some(n => n["Index Name"] === "records_workspace_email_norm_idx" && /"?left"?\(lower\(btrim\(/.test(n["Index Cond"] ?? "")));
            const scans = executedFullScans(plan, "records");
            if (hasOtherKeys) assert.ok(scans.length > 0);
            else assert.equal(scans.length, 0);
        }
    } finally { await pg.close(); }
});
