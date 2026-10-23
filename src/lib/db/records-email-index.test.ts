import test from "node:test";
import assert from "node:assert/strict";
import { createRecordEmailIndex, insertRow, openPglite } from "./pglite-harness.test-helper";
import { EMAIL_TRIM_CHARS, normalizeEmail } from "../deep-visitor-alert-rules";
import { EMAIL_TRIM_SQL, RECORD_EMAIL_KEY, RECORD_EMAIL_PREFIX, recordEmailIndexKeySql, splitEmailKeys } from "./records-email-index";

import { records } from "./schema";

const trimSql = "chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203)";
test("T1: PG trim literal equals all ten EMAIL_TRIM_CHARS and preserves v", async t => {
    const pg = await openPglite([]);
    try {
        t.diagnostic(JSON.stringify((await pg.query("SELECT version() AS version")).rows));
        const { rows } = await pg.query<{ v: string }>(`SELECT ${EMAIL_TRIM_SQL} AS v`);
        assert.equal(rows[0].v, EMAIL_TRIM_CHARS);
        assert.equal(rows[0].v.length, 10);
        for (const value of ["vkim@x.cov", ...[...EMAIL_TRIM_CHARS].map(c => c + "Foo@Bar.com" + c)]) {
            const result = await pg.query<{ v: string }>(`SELECT lower(btrim($1, ${EMAIL_TRIM_SQL})) AS v`, [value]);
            assert.equal(result.rows[0].v, normalizeEmail(value));
        }
    } finally { await pg.close(); }
});
test("T2: expression is exact printable ASCII without template metacharacters", () => {
    assert.equal(RECORD_EMAIL_KEY, "email");
    assert.equal(RECORD_EMAIL_PREFIX, 200);
    assert.equal(EMAIL_TRIM_SQL, trimSql);
    assert.equal(recordEmailIndexKeySql("rm.data"), `left(lower(btrim(rm.data->>'email', ${trimSql})), 200)`);
    for (const text of [EMAIL_TRIM_SQL, recordEmailIndexKeySql("rm.data")]) {
        assert.match(text, /^[\x20-\x7e]+$/);
        assert.doesNotMatch(text, /[\\$`]/);
    }
});
test("T3: splitEmailKeys preserves sets, removes duplicates and isolates email", () => {
    const cases: [string[], boolean, string[]][] = [[[], false, []], [["email"], true, []],
        [["email", "work_email"], true, ["work_email"]], [["work_email"], false, ["work_email"]],
        [["email", "email", "x", "x"], true, ["x"]]];
    for (const [keys, indexed, others] of cases) {
        const actual = splitEmailKeys(keys);
        assert.deepEqual(actual, { indexed, others });
        assert.equal(actual.others.includes("email"), false);
        assert.equal(new Set(actual.others).size, actual.others.length);
        assert.deepEqual(new Set([...(actual.indexed ? ["email"] : []), ...actual.others]), new Set(keys));
    }
});

test("T4: registered DDL creates a prefix index", async () => {
    const pg = await openPglite([records]);
    try {
        await createRecordEmailIndex(pg);
        const result = await pg.query<{ definition: string }>("SELECT pg_get_indexdef('records_workspace_email_norm_idx'::regclass) AS definition");
        assert.match(result.rows[0].definition, /"?left"?\(/);
        assert.match(result.rows[0].definition, /200/);
    } finally { await pg.close(); }
});
test("T5: unbounded control rejects long values; prefix index permits INSERT and UPDATE", async () => {
    const pg = await openPglite([records]);
    const value = Array.from({ length: 10000 }, (_, i) => String.fromCharCode(0xAC00 + (i * 7919 + 13) % 11172)).join("");
    const row = { id: 1, org_id: "00000000-0000-4000-8000-000000000001", workspace_id: 8, partition_id: 1, data: JSON.stringify({ email: value }) };
    try {
        await pg.exec(`CREATE INDEX control_unbounded ON records (workspace_id, (lower(btrim(data->>'email', ${EMAIL_TRIM_SQL}))))`);
        await assert.rejects(insertRow(pg, "records", row), { code: "54000", message: /index row (size|requires)/ });
        await pg.exec("DROP INDEX control_unbounded");
        await createRecordEmailIndex(pg);
        await insertRow(pg, "records", row);
        const updated = [...value].reverse().join("");
        await pg.query("UPDATE records SET data = $1 WHERE id = 1", [JSON.stringify({ email: updated })]);
        assert.equal((await pg.query<{ email: string }>("SELECT data->>'email' AS email FROM records WHERE id = 1")).rows[0].email, updated);
    } finally { await pg.close(); }
});
