import test from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { loadJourneyAudience, summarizeJourneyAudience } from "./customer-journey-audience";
import { createRecordEmailIndex, setIndexValid, explainPrepared, planNodes, usesIndex, executedFullScans, pgliteTag, type CapturedQuery } from "./db/pglite-harness.test-helper";
import { asConnection, canonical, fixtureEmail, fixtureNow, journeyFixture, journeyTarget, legacyJourneyFacts, longEmail } from "./customer-journey-audience-legacy.test-helper";

import { readFileSync } from "node:fs";
import { recordEmailIndexKeySql } from "./db/records-email-index";
import { EMAIL_TRIM_CHARS } from "./deep-visitor-alert-rules";

const indexName = "records_workspace_email_norm_idx";
for (const state of ["absent", "valid", "invalid"] as const) test(`T7: ${state} legacy facts and audience (25 combinations)`, async () => {
    const pg = await journeyFixture();
    try {
        if (state !== "absent") {
            await createRecordEmailIndex(pg);
            await setIndexValid(pg, indexName, state === "valid");
            assert.equal((await pg.query<{ valid: boolean }>("SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = $1::regclass", [indexName])).rows[0].valid, state === "valid");
        }
        for (const keys of [[], ["email"], ["email", "work_email"], ["work_email"], ["email", "email"]]) {
            for (const email of [fixtureEmail, "　KIM@Sample.co.kr\n", longEmail, "", "12345"]) {
                const target = journeyTarget(keys, email);
                const log: CapturedQuery[] = [];
                const conn = asConnection(pgliteTag(pg, log));
                const legacy = await legacyJourneyFacts(conn, target, fixtureNow);
                const actual = await loadJourneyAudience(conn, target, fixtureNow);
                assert.deepEqual(canonical(log.at(-1)!.rows[0]), canonical(legacy), JSON.stringify({ keys, email }));
                assert.deepEqual(canonical(actual), canonical(summarizeJourneyAudience(legacy, target, fixtureNow)));
                if (keys.length === 1 && keys[0] === "email" && email === fixtureEmail) {
                    assert.deepEqual(canonical(legacy.relatedRecords.map(r => r.data._fixture)), canonical(["T", ...Array.from({ length: 11 }, (_, i) => `R${i + 1}`), "R23", "R24", "R25"]));
                }
            }
        }
        await pg.query("UPDATE records SET data = $1 WHERE id = 100", [JSON.stringify({ email: "", _fixture: "T" })]);
        const emptyTarget = journeyTarget(["email"]);
        emptyTarget.fields[0].value = "";
        const emptyLog: CapturedQuery[] = [];
        const emptyConn = asConnection(pgliteTag(pg, emptyLog));
        const emptyLegacy = await legacyJourneyFacts(emptyConn, emptyTarget, fixtureNow);
        const emptyActual = await loadJourneyAudience(emptyConn, emptyTarget, fixtureNow);
        assert.deepEqual(canonical(emptyLog.at(-1)!.rows[0]), canonical(emptyLegacy));
        assert.deepEqual(canonical(emptyActual), canonical(summarizeJourneyAudience(emptyLegacy, emptyTarget, fixtureNow)));
        const target = journeyTarget(["email"]);
        target.session.siteId = 999;
        const conn = asConnection(pgliteTag(pg));
        assert.equal((await legacyJourneyFacts(conn, target, fixtureNow)).authorized, false);
        await assert.rejects(loadJourneyAudience(conn, target, fixtureNow), { message: "고객 여정 대상의 조직·사이트를 확인할 수 없습니다." });
    } finally { await pg.close(); }
});

async function addPlanFixture(pg: PGlite): Promise<void> {
    await pg.exec(`INSERT INTO records (id, org_id, workspace_id, partition_id, data)
        SELECT 1000 + i, '00000000-0000-4000-8000-000000000001', 8, 1,
            jsonb_build_object('email', 'filler-' || i || '@fixture.test') FROM generate_series(1, 2000) i;
        ANALYZE records`);
}
test("T8a: generic and custom use the expression index; parameterized trim control", async t => {
    const pg = await journeyFixture();
    try {
        await createRecordEmailIndex(pg);
        await addPlanFixture(pg);
        const log: CapturedQuery[] = [];
        await loadJourneyAudience(asConnection(pgliteTag(pg, log)), journeyTarget(["email"]), fixtureNow);
        for (const mode of ["generic", "custom"] as const) {
            const plan = await explainPrepared(pg, log.at(-1)!, { mode, analyze: false });
            t.diagnostic(`${mode} plan: ${JSON.stringify(plan)}`);
            assert.equal(usesIndex(plan, indexName), true, mode);
            assert.ok(planNodes(plan).some(n => n["Index Name"] === indexName && /"?left"?\(lower\(btrim\(/.test(n["Index Cond"] ?? "")), `${mode} expression Index Cond`);
        }
        const control = { text: "SELECT rm.id FROM records rm WHERE rm.workspace_id = $1 AND left(lower(btrim(rm.data->>'email', $3)), 200) = left($2, 200)", params: [8, fixtureEmail, EMAIL_TRIM_CHARS] };
        for (const mode of ["generic", "custom"] as const) {
            const plan = await explainPrepared(pg, control, { mode, analyze: false });
            t.diagnostic(`${mode} control: ${JSON.stringify(plan)}`);
            assert.equal(planNodes(plan).some(n => n["Index Name"] === indexName && /"?left"?\(lower\(btrim\(/.test(n["Index Cond"] ?? "")), mode === "custom", `${mode} parameterized trim control`);
        }
    } finally { await pg.close(); }
});
test("T8b: branch gates prevent full scans in generic and custom plans", async t => {
    const pg = await journeyFixture();
    try {
        await createRecordEmailIndex(pg);
        await addPlanFixture(pg);
        for (const keys of [["email"], ["email", "work_email"], ["work_email"], []]) {
            const log: CapturedQuery[] = [];
            await loadJourneyAudience(asConnection(pgliteTag(pg, log)), journeyTarget(keys), fixtureNow);
            for (const mode of ["generic", "custom"] as const) {
                const plan = await explainPrepared(pg, log.at(-1)!, { mode, analyze: true });
                const scans = executedFullScans(plan, "records");
                t.diagnostic(`${mode} ${JSON.stringify(keys)} full scans=${scans.length}: ${JSON.stringify(plan)}`);
                if (keys.includes("work_email")) assert.ok(scans.length > 0);
                else assert.equal(scans.length, 0);
                if (!keys.includes("email")) assert.ok(planNodes(plan).filter(n => n["Index Name"] === indexName && /"?left"?\(lower\(btrim\(/.test(n["Index Cond"] ?? "")).every(n => n["Actual Loops"] === 0));
            }
        }
    } finally { await pg.close(); }
});
test("T9: journey SQL has exactly one literal expression and no unsafe fragments", () => {
    const source = readFileSync(new URL("./customer-journey-audience.ts", import.meta.url), "utf8");
    const expression = recordEmailIndexKeySql("rm.data") + ' = left(${email}, 200)';
    assert.equal(source.split(expression).length - 1, 1);
    assert.equal(source.includes(".unsafe("), false);
    assert.ok(source.includes('const emailKeys = target.fields.filter((f) => contactKindOf(f) === "email").map((f) => f.key);'));
});

test("plan detector counts executed workspace/org-wide scans but not PK or expression lookups", () => {
    const node = { "Node Type": "Index Scan", "Relation Name": "records", "Actual Loops": 1 };
    for (const condition of [undefined, "(workspace_id = $1)", "(org_id = $2)", "((workspace_id = 8) AND (org_id = '00000000-0000-4000-8000-000000000001'::uuid))"]) {
        assert.equal(executedFullScans({ ...node, "Index Cond": condition }, "records").length, 1);
        assert.equal(executedFullScans({ ...node, "Index Cond": condition, "Actual Loops": 0 }, "records").length, 0);
    }
    for (const condition of ["(id = ANY ($1))", "((workspace_id = $1) AND (left(lower(btrim(data->>'email', ' ')), 200) = $2))"]) {
        assert.equal(executedFullScans({ ...node, "Index Cond": condition }, "records").length, 0);
    }
    for (const condition of ["(workspace_id = $1)", "(org_id = $2)"]) {
        assert.equal(executedFullScans({ ...node, "Node Type": "Bitmap Heap Scan", "Recheck Cond": condition }, "records").length, 1);
    }
    assert.equal(executedFullScans({ ...node, "Node Type": "Bitmap Heap Scan", "Recheck Cond": "(id = ANY ($1))" }, "records").length, 0);
    assert.equal(executedFullScans({ ...node, "Node Type": "Seq Scan" }, "records").length, 1);
    assert.equal(executedFullScans({ ...node, "Relation Name": "workspaces" }, "records").length, 0);
});
