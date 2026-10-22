/** Run only against the disposable loopback cluster documented in the incident report. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ensureSendLogIndexes, SEND_LOG_INDEXES } from "../src/lib/db/send-log-indexes";
import { statementTimeoutMs } from "../src/lib/db/connection-options";
import { createWorkerLockManager, workerLockConnection } from "../src/lib/db/worker-lock";

async function main() {
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dataDir = path.join(tmpdir(), "sendb-incident-20261023-pg");
const pid = (await readFile(path.join(dataDir, "postmaster.pid"), "utf8")).trim().split(/\r?\n/);
assert.equal(path.resolve(pid[1]), dataDir);
assert.equal(pid[3], "55623");
process.kill(Number(pid[0]), 0);
const base = "postgresql://sendb_incident_qa@127.0.0.1:55623/";
const admin = postgres(base + "postgres", { max: 1, onnotice: () => {} });
try {
    const [{ dir }] = await admin<{ dir: string }[]>`SELECT current_setting('data_directory') AS dir`;
    assert.equal(path.resolve(dir), dataDir);
} catch (error) { await admin.end({ timeout: 0 }); throw error; }
const database = "sendb_incident_qa_" + randomUUID().replaceAll("-", "");
assert.match(database, /^sendb_incident_qa_[a-f0-9]{32}$/);
await admin.unsafe(`CREATE DATABASE "${database}"`);
const url = base + database;
const sql = postgres(url, { max: 4, onnotice: () => {} });
const evidence: Record<string, unknown> = {
    checkedAt: new Date().toISOString(), fixtureRows: 300_000,
    environment: "isolated loopback PostgreSQL; synthetic @fixture.invalid addresses; no production DB or outbound delivery",
};

type Plan = { [key: string]: unknown; Plans?: Plan[]; "Node Type": string; "Index Name"?: string };
function nodes(plan: Plan): Plan[] { return [plan, ...(plan.Plans ?? []).flatMap(nodes)]; }
async function explain(query: string) {
    const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
    const result = rows[0]["QUERY PLAN"][0];
    const plan = result.Plan as Plan;
    return {
        timeMs: result["Execution Time"],
        blocks: Number(plan["Shared Hit Blocks"] ?? 0) + Number(plan["Shared Read Blocks"] ?? 0),
        scans: nodes(plan).filter((node) => /Scan/.test(node["Node Type"])).map((node) => ({
            type: node["Node Type"], index: node["Index Name"] ?? null,
            removed: node["Rows Removed by Filter"] ?? 0,
        })),
    };
}

try {
    await sql.unsafe(`CREATE TABLE email_send_logs (
        id serial PRIMARY KEY, org_id uuid NOT NULL, partition_id integer,
        template_link_id integer, record_id integer, recipient_email text NOT NULL,
        status text NOT NULL, trigger_type text, sent_at timestamptz NOT NULL,
        request_id text, nhn_status_code text, delivery_fail_source text
    )`);
    await sql.unsafe(`INSERT INTO email_send_logs
        (org_id,partition_id,template_link_id,record_id,recipient_email,status,trigger_type,sent_at,request_id)
        SELECT '00000000-0000-0000-0000-000000000001', n%1000, n%1000, n,
            'lead-'||n||'@fixture.invalid','sent','ai_auto', now()-interval '1 second'*n,'qa-'||n
        FROM generate_series(1,300000) n`);
    // The dev baseline only has these two runtime-built indexes.
    for (const index of SEND_LOG_INDEXES.filter((index) =>
        ["email_send_logs_org_sent_at_idx", "email_send_logs_request_id_idx"].includes(index.name)))
        await sql.unsafe(index.ddl);
    await sql`ANALYZE email_send_logs`;
    const accepted = "(status='sent' OR (status='failed' AND request_id IS NOT NULL AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL)))";
    const queries = {
        partitionDuplicate: `SELECT id FROM email_send_logs WHERE partition_id=55 AND recipient_email='absent@fixture.invalid' AND trigger_type='ai_auto' AND ${accepted} LIMIT 1`,
        templateDuplicate: `SELECT id FROM email_send_logs WHERE template_link_id=55 AND recipient_email='absent@fixture.invalid' AND ${accepted} LIMIT 1`,
        recordCooldown: `SELECT id FROM email_send_logs WHERE record_id=999999 AND trigger_type='ai_auto' AND sent_at>=now()-interval '1 hour' AND (${accepted} OR status='pending') LIMIT 1`,
        exactRecipient: `SELECT id FROM email_send_logs WHERE org_id='00000000-0000-0000-0000-000000000001' AND lower(recipient_email)=lower('LEAD-12345@fixture.invalid')`,
    };
    const before: Record<string, Awaited<ReturnType<typeof explain>>> = Object.fromEntries(await Promise.all(Object.entries(queries).map(async ([key, query]) => [key, await explain(query)] as const)));
    const answers = await Promise.all(Object.values(queries).map((query) => sql.unsafe(query)));
    const built = await ensureSendLogIndexes(url, { attempts: 1 });
    assert.equal(built.ready, true);
    await sql`ANALYZE email_send_logs`;
    const after: Record<string, Awaited<ReturnType<typeof explain>>> = Object.fromEntries(await Promise.all(Object.entries(queries).map(async ([key, query]) => [key, await explain(query)] as const)));
    for (const [key, plan] of Object.entries(after)) {
        assert.ok(plan.scans.some((scan) => scan.index), `${key}: must use an index`);
        assert.ok(plan.scans.every((scan) => !scan.type.includes("Seq Scan")), `${key}: no full scan`);
        assert.ok(plan.blocks < before[key].blocks / 10, `${key}: reduce block visits by at least 90%`);
    }
    assert.deepEqual(await Promise.all(Object.values(queries).map((query) => sql.unsafe(query))), answers);
    evidence.queryPlans = { before, after };

    // A second build preserves the valid indexes (and their OIDs).
    const indexOids = async () => sql`SELECT c.relname,c.oid FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relname LIKE 'email_send_logs_%' ORDER BY c.relname`;
    const firstOids = await indexOids();
    assert.equal((await ensureSendLogIndexes(url, { attempts: 1 })).ready, true);
    assert.deepEqual(await indexOids(), firstOids);
    evidence.idempotentIndexBuild = true;

    // A failed concurrent unique build leaves an invalid index. Repair it using
    // the actual startup code; do not merely check strings containing CONCURRENTLY.
    await sql`DROP INDEX email_send_logs_partition_recipient_idx`;
    await assert.rejects(sql.unsafe(`CREATE UNIQUE INDEX CONCURRENTLY email_send_logs_partition_recipient_idx ON email_send_logs(partition_id)`));
    const [invalid] = await sql`SELECT indisvalid FROM pg_index WHERE indexrelid='email_send_logs_partition_recipient_idx'::regclass`;
    assert.equal(invalid.indisvalid, false);
    assert.equal((await ensureSendLogIndexes(url, { attempts: 1 })).ready, true);
    const [valid] = await sql`SELECT indisvalid FROM pg_index WHERE indexrelid='email_send_logs_partition_recipient_idx'::regclass`;
    assert.equal(valid.indisvalid, true);
    evidence.invalidIndexRepair = true;

    // Competing startup instances must not run the same build concurrently.
    const holder = await sql.reserve();
    try {
        await holder`SELECT pg_advisory_lock(${0x5c4edf0a})`;
        assert.equal((await ensureSendLogIndexes(url)).skippedAsLocked, true);
    } finally { await holder`SELECT pg_advisory_unlock_all()`; holder.release(); }
    evidence.concurrentBuilderGuard = true;

    // A temporarily locked table must recover without a process restart.
    await sql`DROP INDEX email_send_logs_record_idx`;
    const blocker = await sql.reserve();
    await blocker`BEGIN`; await blocker`LOCK TABLE email_send_logs IN ACCESS EXCLUSIVE MODE`;
    const retryBuild = ensureSendLogIndexes(url, { attempts: 3, retryDelayMs: 150, lockTimeoutMs: 50, statementTimeoutMs: 1000 });
    await delay(100);
    await blocker`ROLLBACK`; blocker.release();
    assert.equal((await retryBuild).ready, true);
    evidence.transientIndexRetry = true;

    const timed = postgres(url, { max: 1, connection: { statement_timeout: statementTimeoutMs("40") } });
    try {
        await assert.rejects(timed`SELECT pg_sleep(0.5)`, (error: unknown) => (error as { code: string }).code === "57014");
        assert.equal((await timed`SELECT 1 AS value`)[0].value, 1);
        evidence.queryTimeoutAndRecovery = true;
    } finally { await timed.end({ timeout: 0 }); }

    // Statement timeouts cannot rescue queries waiting in the JS pool queue.
    const app = postgres(url, { max: 2, connection: { statement_timeout: 40 } });
    const reserved = await Promise.all([app.reserve(), app.reserve()]);
    let pendingFinished = false;
    const pending = app`SELECT 1 AS value`.then((rows) => { pendingFinished = true; return rows; });
    await delay(100);
    assert.equal(pendingFinished, false);
    reserved.forEach((conn) => conn.release());
    await pending;
    evidence.sharedPoolStarvationReproduced = true;

    const manager = createWorkerLockManager(() => workerLockConnection(url));
    const leases = await Promise.all([1,2,3,4].map((key) => manager.acquire(80000+key)));
    assert.ok(leases.every(Boolean));
    let fifthAcquired = false;
    const fifth = manager.acquire(80005).then((lease) => { fifthAcquired = true; return lease; });
    await delay(20);
    assert.equal(fifthAcquired, false);
    assert.equal(await manager.acquire(80005), null);
    const started = performance.now();
    try {
        const calls = await Promise.race([
            Promise.all(Array.from({length:20}, () => app`SELECT 1 AS value`)),
            delay(2000).then(() => { throw new Error("application pool starved by worker locks"); }),
        ]);
        assert.equal(calls.length, 20);
        evidence.applicationQueriesWithFourWorkerLocks = { calls: 20, elapsedMs: Math.round(performance.now()-started) };
    } finally {
        await Promise.all(leases.map((lease) => lease!.release()));
        await (await fifth)!.release();
        await app.end({timeout:0});
    }
    evidence.workerCapacityBoundAndFifoWait = true;
    const contender = workerLockConnection(url);
    try { assert.equal(await contender.tryLock(80001), true); }
    finally { await contender.close(); }
    evidence.workerSessionCloseReleasesLock = true;

    await writeFile(".testenv/incident-db-evidence.json", JSON.stringify(evidence,null,2)+"\n");
    console.log(JSON.stringify(evidence,null,2));
} finally {
    await sql.end({ timeout: 0 });
    await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end({ timeout: 0 });
}
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
