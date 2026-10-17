import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { EsignService } from "./core";
import { createPostgresEsignSql, PostgresEsignRepository, type EsignSql } from "./postgres-repository";
import type { EsignActor, EsignDocumentInput, EsignJob, SignatureInput } from "./types";

// Opt in only to the fresh, fake-only loopback cluster created for this task.
const allowedUrl = "postgresql://esign_qa@127.0.0.1:15473/sendb_esign_native_qa";
const nativeUrl = process.env.ESIGN_NATIVE_TEST_URL;
if (nativeUrl && nativeUrl !== allowedUrl) throw new Error("Native e-sign tests require the exact isolated loopback QA database.");
const secret = "native-fake-only-esign-secret-at-least-32-characters";
const source = { key: "esign/native/source.pdf", sha256: "a".repeat(64), size: 1000, contentType: "application/pdf" as const };
function deferred() {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test("native PostgreSQL: two connections enforce CAS, atomic signatures, locks, global PDF leases and tenant scope", { skip: !nativeUrl, timeout: 60000 }, async (t) => {
    const connectionA = createPostgresEsignSql(allowedUrl, 1), connectionB = createPostgresEsignSql(allowedUrl, 1);
    const repositoryA = new PostgresEsignRepository(connectionA), repositoryB = new PostgresEsignRepository(connectionB);
    let now = new Date("2026-10-18T01:00:00.000Z");
    const serviceA = new EsignService({ repository: repositoryA, secret, clock: () => new Date(now) });
    const serviceB = new EsignService({ repository: repositoryB, secret, clock: () => new Date(now) });
    const actors: EsignActor[] = [];
    const actor = (): EsignActor => { const value = { orgId: randomUUID(), workspaceId: 17, userId: randomUUID(), name: "가상 SQL 검수 직원" }; actors.push(value); return value; };
    async function create(owner: EsignActor) {
        const document = await serviceA.createDocument(owner, { title: "격리 native 계약", kind: "template", artifact: source, pages: [{ pageIndex: 0, width: 600, height: 800, rotation: 0, crop: { x: 0, y: 0, width: 600, height: 800 } }], fields: [{ id: "signature", recipientIndex: 0, type: "signature", pageIndex: 0, x: 0.2, y: 0.3, width: 0.2, height: 0.1, required: true }] });
        const created = await serviceA.createEnvelope(owner, { documentId: document.id, title: "가상 계약 SQL 검수", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상 서명자", email: "native-fake@example.invalid", channels: ["email"] }] });
        const id = created.envelope.id, stored = (await repositoryA.read(id))!, token = serviceA.decodeJob(stored.jobs[0]).token!;
        await serviceA.dispatchEnvelope(owner, id);
        return { owner, id, document, token, recipientId: stored.recipients[0].id };
    }
    type Contract = Awaited<ReturnType<typeof create>>;
    async function verify(contract: Contract) {
        await serviceA.requestOtp(contract.token, "email");
        const stored = (await repositoryA.read(contract.id))!, job = stored.jobs.filter((j) => j.kind === "otp").at(-1)!;
        const code = serviceA.decodeJob(job).code!;
        return serviceA.verifyOtp(contract.token, code);
    }
    const input = (contract: Contract, verificationToken: string): SignatureInput => ({ verificationToken, idempotencyKey: `native-${contract.id}`, consent: true, values: [{ fieldId: "signature", artifact: { key: `esign/signatures/${contract.id}/${contract.recipientId}/fake.png`, sha256: "b".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } }] });
    async function completeFinal(job: EsignJob) {
        return serviceA.finishEnvelope(job.id, job.envelopeId, job.leaseId!, { artifact: { key: `esign/completed/${job.envelopeId}/fake.pdf`, sha256: "c".repeat(64), size: 1200, contentType: "application/pdf" }, verified: true });
    }
    async function drainNotices() {
        for (let i = 0; i < 20; i++) {
            const job = await serviceA.claimJob();
            if (!job) return;
            assert.notEqual(job.kind, "finalize", "Test must explicitly verify each completion lease");
            await serviceA.completeDelivery(job.id, job.envelopeId, job.leaseId!, { state: "accepted", providerId: "fake-native-provider" });
        }
        throw new Error("Native notification drain exceeded its bound");
    }
    async function hold(sql: EsignSql, statement: string, params: unknown[] = []) {
        const entered = deferred(), release = deferred();
        const timer = setTimeout(release.resolve, 1500);
        const done = sql.transaction(async (tx) => { await tx.query(statement, params); entered.resolve(); await release.promise; }).catch((error) => { entered.reject(error); throw error; });
        await entered.promise;
        return { done, release: () => { clearTimeout(timer); release.resolve(); } };
    }
    try {
        await connectionA.query("SET statement_timeout='5s'"); await connectionA.query("SET lock_timeout='3s'");
        await connectionB.query("SET statement_timeout='5s'"); await connectionB.query("SET lock_timeout='3s'");
        const database = await connectionA.query<{ name: string; port: number }>("SELECT current_database() name, inet_server_port() port");
        assert.equal(database.rows[0].name, "sendb_esign_native_qa"); assert.equal(database.rows[0].port, 15473);
        const [pidA, pidB] = await Promise.all([connectionA.query<{ pid: number }>("SELECT pg_backend_pid() pid"), connectionB.query<{ pid: number }>("SELECT pg_backend_pid() pid")]);
        assert.notEqual(pidA.rows[0].pid, pidB.rows[0].pid, "Requires two genuine server sessions");
        await connectionA.query(await readFile(new URL("../../../drizzle/esign/0001.sql", import.meta.url), "utf8"));
        const beforeDeadlocks = await connectionA.query<{ count: string }>("SELECT deadlocks::text count FROM pg_stat_database WHERE datname=current_database()");

        await t.test("concurrent document CAS, scope boundaries, rollback and committed OTP failure counts", async () => {
            const owner = actor(), contract = await create(owner);
            const edits = await Promise.allSettled([serviceA.updateDocument(owner, contract.document.id, { title: "동시 A", version: 1 }), serviceB.updateDocument(owner, contract.document.id, { title: "동시 B", version: 1 })]);
            assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal((await serviceA.getDocument(owner, contract.document.id)).version, 2);
            const jsonType = await connectionA.query<{ kind: string }>("SELECT jsonb_typeof(data) kind FROM esign.documents WHERE id=$1", [contract.document.id]);
            assert.equal(jsonType.rows[0].kind, "object", "Driver JSON parameters must not be double serialized");
            assert.equal((await serviceA.getEnvelope(owner, contract.id)).envelope.document.version, 1);
            const listed = await serviceB.listEnvelopes(owner);
            assert.equal(listed[0].envelope.id, contract.id); assert.equal(listed[0].recipients.length, 1);
            assert.equal(listed[0].jobs.length, 0); assert.equal(listed[0].events.length, 0);
            assert.equal((await serviceB.listDocuments(owner)).length, 1);
            await assert.rejects(serviceB.getEnvelope({ ...owner, workspaceId: 99 }, contract.id), /찾을 수/);
            assert.equal((await serviceB.listEnvelopes({ ...owner, orgId: randomUUID() })).length, 0);
            await assert.rejects(repositoryA.mutate(contract.id, (a) => { a.envelope.state = "cancelled"; throw new Error("native-rollback"); }), /native-rollback/);
            assert.equal((await serviceB.getEnvelope(owner, contract.id)).envelope.state, "pending");
            await serviceA.requestOtp(contract.token, "email");
            const failures = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => (i % 2 ? serviceA : serviceB).verifyOtp(contract.token, "wrong")));
            assert(failures.every((r) => r.status === "rejected"));
            assert.equal((await repositoryB.read(contract.id))!.recipients[0].otpAttempts, 5);
            await serviceA.cancelEnvelope(owner, contract.id);
            const expiring = await create(owner), invitation = (await serviceA.claimJob())!;
            await serviceA.completeDelivery(invitation.id, expiring.id, invitation.leaseId!, { state: "accepted" });
            const previousTime = now;
            try {
                now = new Date("2026-10-19T01:00:00.000Z");
                assert.equal((await serviceA.expireDue()).processed, 1);
                const expired = (await repositoryB.read(expiring.id))!;
                assert.equal(expired.envelope.state, "expired");
                assert(expired.jobs.every((j) => !j.encryptedPayload));
            } finally { now = previousTime; }
        });

        await t.test("same signature on two connections is exact-once; sign/cancel race never regresses state", async () => {
            const owner = actor(), contract = await create(owner), verified = await verify(contract), signature = input(contract, verified.verificationToken);
            const results = await Promise.all([serviceA.submitSignature(contract.token, signature), serviceB.submitSignature(contract.token, signature)]);
            assert(results.every((r) => r.state === "finalizing"));
            const state = (await repositoryA.read(contract.id))!;
            assert.equal(state.events.filter((e) => e.type === "recipient.signed").length, 1);
            assert.equal(state.jobs.filter((j) => j.kind === "finalize").length, 1);
            const final = (await serviceA.claimJob())!; assert.equal(final.kind, "finalize"); await completeFinal(final); await drainNotices();
            const raced = await create(owner), raceVerified = await verify(raced);
            await Promise.allSettled([serviceA.submitSignature(raced.token, input(raced, raceVerified.verificationToken)), serviceB.cancelEnvelope(owner, raced.id)]);
            const raceState = (await repositoryA.read(raced.id))!;
            assert(["cancelled", "finalizing"].includes(raceState.envelope.state));
            assert(raceState.events.filter((e) => e.type === "recipient.signed").length <= 1);
            if (raceState.envelope.state === "finalizing") { const raceFinal = (await serviceA.claimJob())!; await completeFinal(raceFinal); await drainNotices(); }
        });

        await t.test("advisory contention returns immediately; locked envelopes are skipped without deadlocks", async () => {
            const owner = actor(), first = await create(owner), second = await create(owner);
            const advisory = await hold(connectionA, "SELECT pg_advisory_xact_lock(1936029031)");
            try { assert.equal(await serviceB.claimJob(), null); } finally { advisory.release(); await advisory.done; }
            const envelopeLock = await hold(connectionA, "SELECT id FROM esign.envelopes WHERE id=$1 FOR UPDATE", [first.id]);
            try {
                const job = (await serviceB.claimJob())!;
                assert.equal(job.envelopeId, second.id);
                await serviceB.completeDelivery(job.id, second.id, job.leaseId!, { state: "accepted" });
            } finally { envelopeLock.release(); await envelopeLock.done; }
            await serviceA.cancelEnvelope(owner, first.id); await serviceA.cancelEnvelope(owner, second.id);
        });

        await t.test("one global PDF lease allows delivery, recovers expiry, rejects stale workers and never retries unknown sends", async () => {
            const owner = actor(), first = await create(owner), second = await create(owner);
            const v1 = await verify(first), v2 = await verify(second);
            await serviceA.submitSignature(first.token, input(first, v1.verificationToken));
            await serviceB.submitSignature(second.token, input(second, v2.verificationToken));
            const claimed = await Promise.all([serviceA.claimJob(), serviceB.claimJob()]);
            const live = claimed.filter((j): j is EsignJob => !!j);
            assert.equal(live.length, 1); assert.equal(live[0].kind, "finalize");
            const heldFinal = live[0];
            const third = await create(owner);
            await serviceA.requestOtp(third.token, "email");
            const deliveries: EsignJob[] = [];
            for (let i = 0; i < 2; i++) {
                const job = (await serviceB.claimJob())!;
                assert(["invitation", "otp"].includes(job.kind)); deliveries.push(job);
                await serviceB.completeDelivery(job.id, third.id, job.leaseId!, { state: job.kind === "invitation" ? "unknown" : "accepted" });
            }
            assert.equal(await serviceB.claimJob(), null, "The second PDF is blocked while delivery remains available");
            now = new Date(now.getTime() + 61000);
            const recovered = (await serviceB.claimJob())!;
            assert.equal(recovered.id, heldFinal.id); assert.notEqual(recovered.leaseId, heldFinal.leaseId);
            await assert.rejects(serviceA.getFinalizationInput(heldFinal.id, heldFinal.envelopeId, heldFinal.leaseId!), /권한/);
            await completeFinal(recovered);
            let remaining: EsignJob | null = null;
            for (let i = 0; i < 10; i++) {
                const job = await serviceA.claimJob();
                if (!job) break;
                if (job.kind === "finalize") { remaining = job; break; }
                await serviceA.completeDelivery(job.id, job.envelopeId, job.leaseId!, { state: "accepted" });
            }
            assert(remaining); assert.notEqual(remaining.envelopeId, heldFinal.envelopeId);
            await completeFinal(remaining); await drainNotices();
            const unknown = (await repositoryA.read(third.id))!.jobs.find((j) => j.kind === "invitation")!;
            assert.equal(unknown.state, "unknown"); assert.equal(unknown.attempts, 1);
            assert.equal(await serviceA.claimJob(), null);
            await serviceA.cancelEnvelope(owner, third.id);
            const ended = (await repositoryA.read(third.id))!;
            assert(ended.jobs.every((j) => !j.encryptedPayload));
            const persisted = JSON.stringify((await repositoryA.read(first.id))!.recipients);
            assert(!persisted.includes(first.token)); assert(!persisted.includes(v1.verificationToken));
            assert.equal(deliveries.length, 2);
        });
        await t.test("a later OTP overtakes an older invitation backlog; active-job partial indexes match claim/gate expressions", async () => {
            const owner = actor(), backlog: Contract[] = [];
            for (let i = 0; i < 8; i++) backlog.push(await create(owner));
            const signer = await create(owner), verified = await verify(signer);
            await serviceA.submitSignature(signer.token, input(signer, verified.verificationToken));
            now = new Date(now.getTime() + 60000);
            const target = await create(owner);
            await serviceA.requestOtp(target.token, "email");
            const otp = (await serviceB.claimJob())!;
            assert.equal(otp.kind, "otp"); assert.equal(otp.envelopeId, target.id);
            await serviceB.completeDelivery(otp.id, target.id, otp.leaseId!, { state: "accepted" });
            const final = (await serviceA.claimJob())!;
            assert.equal(final.kind, "finalize"); assert.equal(final.envelopeId, signer.id);
            const invitation = (await serviceB.claimJob())!;
            assert.equal(invitation.kind, "invitation");
            await serviceB.completeDelivery(invitation.id, invitation.envelopeId, invitation.leaseId!, { state: "unknown" });
            const another = (await serviceA.claimJob())!;
            assert.equal(another.kind, "invitation"); assert.notEqual(another.id, invitation.id);
            await serviceA.completeDelivery(another.id, another.envelopeId, another.leaseId!, { state: "accepted" });
            const plans = await connectionB.transaction(async (tx) => {
                // A tiny fixture normally favors a sequential scan; disable it only to verify usable index paths.
                await tx.query("SET LOCAL enable_seqscan=off");
                const priority = await tx.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT id FROM esign.jobs WHERE state IN ('pending','processing') ORDER BY CASE WHEN kind='otp' THEN 0 WHEN kind='finalize' THEN 1 ELSE 2 END,available_at,id LIMIT 1");
                const lease = await tx.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT EXISTS(SELECT 1 FROM esign.jobs WHERE kind='finalize' AND state='processing' AND lease_until>$1)", [now.toISOString()]);
                return { priority: priority.rows.map((r) => r["QUERY PLAN"]).join("\n"), lease: lease.rows.map((r) => r["QUERY PLAN"]).join("\n") };
            });
            assert(plans.priority.includes("esign_jobs_priority_due"));
            assert(plans.lease.includes("esign_jobs_finalize_lease"));
            t.diagnostic(`Active fixture priority index path:\n${plans.priority}`);
            t.diagnostic(`Active fixture finalize lease index path:\n${plans.lease}`);
            await completeFinal(final);
            for (const contract of [...backlog, target]) await serviceA.cancelEnvelope(owner, contract.id);
            await drainNotices();
        });
        await t.test("two genuine connections enforce a shared pixel budget before the second signature commits", async () => {
            const owner = actor(), fields: EsignDocumentInput["fields"] = [0, 1].flatMap((recipientIndex) => Array.from({ length: 3 }, (_, i) => ({ id: `image-${recipientIndex}-${i}`, recipientIndex, type: "signature", pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.1, required: true })));
            const document = await serviceA.createDocument(owner, { title: "Native 다자 예산", kind: "template", artifact: source, pages: [{ pageIndex: 0, width: 600, height: 800, rotation: 0, crop: { x: 0, y: 0, width: 600, height: 800 } }], fields });
            const created = await serviceA.createEnvelope(owner, { documentId: document.id, title: "Native 픽셀 예산", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [0, 1].map((i) => ({ name: `가상 ${i}`, email: `fake-${i}@example.invalid`, channels: ["email" as const] })) });
            const id = created.envelope.id;
            await serviceA.dispatchEnvelope(owner, id);
            const stored = (await repositoryA.read(id))!;
            const tokens = stored.recipients.map((r) => serviceA.decodeJob(stored.jobs.find((j) => j.kind === "invitation" && j.recipientId === r.id)!).token!);
            const inputs = await Promise.all(tokens.map(async (token, recipientIndex): Promise<SignatureInput> => {
                await serviceA.requestOtp(token, "email");
                const otp = (await repositoryA.read(id))!.jobs.find((j) => j.kind === "otp" && j.recipientId === stored.recipients[recipientIndex].id)!;
                const verified = await serviceA.verifyOtp(token, serviceA.decodeJob(otp).code!);
                return { verificationToken: verified.verificationToken, idempotencyKey: `native-budget-${recipientIndex}`, consent: true, values: fields.filter((field) => field.recipientIndex === recipientIndex).map((field, i) => ({ fieldId: field.id, raster: { width: 1000, height: 2000 }, artifact: { key: `esign/signatures/${id}/${stored.recipients[recipientIndex].id}/${i}.png`, sha256: (recipientIndex * 10 + i + 1).toString(16).padStart(64, "0"), size: 500, contentType: "image/png" } })) };
            }));
            const before = (await repositoryA.read(id))!;
            const results = await Promise.allSettled([serviceA.submitSignature(tokens[0], inputs[0]), serviceB.submitSignature(tokens[1], inputs[1])]);
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status, 413);
            const after = (await repositoryB.read(id))!;
            assert.equal(after.envelope.version, before.envelope.version + 1);
            assert.equal(after.envelope.state, "pending");
            assert.equal(after.recipients.filter((r) => r.state === "signed").length, 1);
            assert.equal(after.events.filter((e) => e.type === "recipient.signed").length, 1);
            assert.equal(after.jobs.filter((j) => j.kind === "finalize").length, 0);
            await serviceA.cancelEnvelope(owner, id);
        });
        const afterDeadlocks = await connectionA.query<{ count: string }>("SELECT deadlocks::text count FROM pg_stat_database WHERE datname=current_database()");
        assert.equal(afterDeadlocks.rows[0].count, beforeDeadlocks.rows[0].count);
    } finally {
        // Delete only fresh fake actors created by this test, in this exact isolated database.
        for (const owner of actors) {
            await connectionA.query("DELETE FROM esign.jobs WHERE envelope_id IN(SELECT id FROM esign.envelopes WHERE org_id=$1)", [owner.orgId]);
            await connectionA.query("DELETE FROM esign.events WHERE envelope_id IN(SELECT id FROM esign.envelopes WHERE org_id=$1)", [owner.orgId]);
            await connectionA.query("DELETE FROM esign.recipients WHERE envelope_id IN(SELECT id FROM esign.envelopes WHERE org_id=$1)", [owner.orgId]);
            await connectionA.query("DELETE FROM esign.envelopes WHERE org_id=$1", [owner.orgId]);
            await connectionA.query("DELETE FROM esign.documents WHERE org_id=$1", [owner.orgId]);
        }
        await connectionA.close?.(); await connectionB.close?.();
    }
});
