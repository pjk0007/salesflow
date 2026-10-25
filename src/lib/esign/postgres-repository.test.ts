import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { EsignService } from "./core";
import { PostgresEsignRepository, type EsignSql } from "./postgres-repository";
import type { EsignActor, EsignDocumentInput, SignatureInput } from "./types";

const actor: EsignActor = { orgId: "00000000-0000-4000-8000-000000000011", workspaceId: 11, userId: "00000000-0000-4000-8000-000000000012", name: "가상 직원" };
const secret = "isolated-pglite-contract-secret-minimum-32-bytes";
async function isolated() {
    const database = new PGlite();
    await database.exec(await readFile(new URL("../../../drizzle/esign/0001.sql", import.meta.url), "utf8"));
    const wrap = (connection: Pick<PGlite, "query">, inside = false): EsignSql => ({
        async query<T>(text: string, params: unknown[] = []) { const result = await connection.query<T>(text, params); return { rows: result.rows }; },
        async transaction<T>(action: (tx: EsignSql) => Promise<T>) {
            if (inside) throw new Error("Nested test transaction");
            return database.transaction((tx) => action(wrap(tx, true)));
        },
    });
    const repository = new PostgresEsignRepository(wrap(database));
    let time = new Date("2026-10-18T01:00:00.000Z");
    const service = new EsignService({ repository, secret, clock: () => new Date(time) });
    const document = await service.createDocument(actor, { title: "격리 SQL 계약", kind: "template", artifact: { key: "esign/isolated/source.pdf", sha256: "a".repeat(64), size: 1000, contentType: "application/pdf" }, pages: [{ pageIndex: 0, width: 600, height: 800, rotation: 0, crop: { x: 0, y: 0, width: 600, height: 800 } }], fields: [{ id: "signature", recipientIndex: 0, type: "signature", pageIndex: 0, x: 0.2, y: 0.3, width: 0.2, height: 0.1, required: true }] });
    const created = await service.createEnvelope(actor, { documentId: document.id, title: "SQL 검수", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상 서명자", email: "fake@example.invalid", phone: "+821000000000", channels: ["email", "sms"] }] });
    const id = created.envelope.id, value = (await repository.read(id))!, token = service.decodeJob(value.jobs[0]).token!;
    await service.dispatchEnvelope(actor, id);
    async function verify() {
        await service.requestOtp(token, "email");
        const latest = (await repository.read(id))!, job = latest.jobs.find((j) => j.kind === "otp")!;
        const code = service.decodeJob(job).code!;
        const verified = await service.verifyOtp(token, code);
        return { ...verified, code };
    }
    function signature(verificationToken: string): SignatureInput {
        return { verificationToken, idempotencyKey: "stable-sql-submission", consent: true, values: [{ fieldId: "signature", artifact: { key: `esign/signatures/${id}/${value.recipients[0].id}/stamp.png`, sha256: "b".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } }] };
    }
    return { database, repository, service, id, token, document, verify, signature, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
test("isolated PostgreSQL schema persists atomic OTP attempts, immutable snapshots and exact-once signature jobs", async () => {
    const f = await isolated();
    try {
        await f.service.requestOtp(f.token, "email");
        await assert.rejects(f.service.verifyOtp(f.token, "wrong"), /일치/);
        assert.equal((await f.repository.read(f.id))!.recipients[0].otpAttempts, 1);
        const aggregate = (await f.repository.read(f.id))!, code = f.service.decodeJob(aggregate.jobs.find((j) => j.kind === "otp")!).code!;
        const verified = await f.service.verifyOtp(f.token, code);
        const input = f.signature(verified.verificationToken);
        await Promise.all([f.service.submitSignature(f.token, input), f.service.submitSignature(f.token, input)]);
        const after = (await f.repository.read(f.id))!;
        assert.equal(after.envelope.state, "finalizing");
        assert.equal(after.events.filter((e) => e.type === "recipient.signed").length, 1);
        assert.equal(after.jobs.filter((j) => j.kind === "finalize").length, 1);
        const versions = await f.database.query<{ version: number; json_version: string }>("SELECT version,data->>'version' json_version FROM esign.envelopes WHERE id=$1", [f.id]);
        assert.equal(versions.rows[0].version, Number(versions.rows[0].json_version));
        await f.service.updateDocument(actor, f.document.id, { title: "변경된 템플릿", version: 1 });
        await assert.rejects(f.service.updateDocument(actor, f.document.id, { title: "낡은 저장", version: 1 }), /변경/);
        await assert.rejects(f.service.getDocument({ ...actor, workspaceId: 12 }, f.document.id), /찾을 수/);
        await assert.rejects(f.service.getEnvelope({ ...actor, orgId: "00000000-0000-4000-8000-000000000099" }, f.id), /찾을 수/);
        assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.document.title, "격리 SQL 계약");
        assert.equal((await f.service.listEnvelopes(actor)).items.length, 1);
        assert.equal("events" in (await f.service.listEnvelopes(actor)).items[0], false);
        assert.equal("document" in (await f.service.listEnvelopes(actor)).items[0].envelope, false, "목록은 문서 스냅샷을 읽지 않는다");
        assert.equal((await f.service.listEnvelopes({ ...actor, workspaceId: 12 })).items.length, 0);
        await assert.rejects(f.repository.mutate(f.id, (a) => { a.envelope.state = "cancelled"; throw new Error("rollback-test"); }), /rollback-test/);
        assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.state, "finalizing");
        const bytes = JSON.stringify((await f.database.query("SELECT data FROM esign.recipients")).rows);
        assert(!bytes.includes(f.token)); assert(!bytes.includes(verified.verificationToken));
        const blobs = await f.database.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='esign' ORDER BY table_name");
        assert.deepEqual(blobs.rows.map((r) => r.table_name), ["documents", "envelopes", "events", "jobs", "recipients"]);
        f.advance(1);
        const expiring = await f.service.createEnvelope(actor, { documentId: f.document.id, title: "최신 만료 검수", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상", email: "later@example.invalid", channels: ["email"] }] });
        assert.equal((await f.service.listEnvelopes(actor)).items[0].envelope.id, expiring.envelope.id);
        f.advance(86400000);
        assert.equal((await f.service.expireDue()).processed, 1);
        const expired = (await f.repository.read(expiring.envelope.id))!;
        assert.equal(expired.envelope.state, "expired");
        assert(expired.jobs.every((j) => !j.encryptedPayload));
    } finally { await f.database.close(); }
});
test("isolated PostgreSQL leases distinguish delivery acceptance/unknown and recover only PDF completion", async () => {
    const f = await isolated();
    try {
        const [one, two] = await Promise.all([f.service.claimJob(), f.service.claimJob()]);
        assert(one && two); assert.notEqual(one.id, two.id);
        await f.service.completeDelivery(one.id, f.id, one.leaseId!, { state: "accepted", providerId: "fake-provider" });
        f.advance(61000);
        assert.equal(await f.service.claimJob(), null);
        assert.equal((await f.repository.read(f.id))!.jobs.find((j) => j.id === two.id)?.state, "unknown");
        const v = await f.verify();
        await f.service.submitSignature(f.token, f.signature(v.verificationToken));
        const final = (await f.service.claimJob())!;
        assert.equal(final.kind, "finalize");
        f.advance(1);
        const other = await f.service.createEnvelope(actor, { documentId: f.document.id, title: "동시 SQL 계약", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "다른 가상 서명자", email: "second@example.invalid", channels: ["email"] }] });
        const otherId = other.envelope.id, otherData = (await f.repository.read(otherId))!, otherToken = f.service.decodeJob(otherData.jobs[0]).token!;
        await f.service.dispatchEnvelope(actor, otherId);
        const whileFinalizing = (await f.service.claimJob())!;
        assert.equal(whileFinalizing.kind, "invitation");
        await f.service.completeDelivery(whileFinalizing.id, otherId, whileFinalizing.leaseId!, { state: "accepted" });
        await f.service.requestOtp(otherToken, "email");
        const otpDuringPdf = (await f.service.claimJob())!;
        assert.equal(otpDuringPdf.kind, "otp");
        const otherCode = f.service.decodeJob(otpDuringPdf).code!;
        await f.service.completeDelivery(otpDuringPdf.id, otherId, otpDuringPdf.leaseId!, { state: "accepted" });
        const otherVerified = await f.service.verifyOtp(otherToken, otherCode);
        await f.service.submitSignature(otherToken, { verificationToken: otherVerified.verificationToken, idempotencyKey: "second-sql-submission", consent: true, values: [{ fieldId: "signature", artifact: { key: `esign/signatures/${otherId}/${otherData.recipients[0].id}/stamp.png`, sha256: "b".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } }] });
        assert.equal(await f.service.claimJob(), null, "A live PDF lease blocks a second envelope PDF, but not invitation/OTP delivery");
        f.advance(61000);
        const reclaimed = (await f.service.claimJob())!;
        assert.equal(reclaimed.id, final.id); assert.notEqual(reclaimed.leaseId, final.leaseId);
        await assert.rejects(f.service.finishEnvelope(final.id, f.id, final.leaseId!, { artifact: { key: "esign/completed/stale.pdf", sha256: "c".repeat(64), size: 1200, contentType: "application/pdf" }, verified: true }), /권한/);
        const completed = await f.service.finishEnvelope(reclaimed.id, f.id, reclaimed.leaseId!, { artifact: { key: "esign/completed/final.pdf", sha256: "c".repeat(64), size: 12 * 1024 * 1024, contentType: "application/pdf" }, verified: true });
        assert.equal(completed.envelope.state, "completed");
        const secondPdf = (await f.service.claimJob())!;
        assert.equal(secondPdf.envelopeId, otherId); assert.equal(secondPdf.kind, "finalize");
        await f.service.failFinalization(secondPdf.id, otherId, secondPdf.leaseId!);
        const jobs = (await f.repository.read(f.id))!.jobs;
        assert(jobs.filter((j) => j.kind === "invitation").every((j) => !j.encryptedPayload));
        assert.equal(jobs.filter((j) => j.kind === "completed").length, 2);
        for (let i = 0; i < 2; i++) {
            const notice = (await f.service.claimJob())!;
            assert.equal(notice.kind, "completed");
            assert.equal(f.service.decodeJob(notice).token, f.token);
            await f.service.completeDelivery(notice.id, f.id, notice.leaseId!, { state: "accepted" });
        }
        assert((await f.repository.read(f.id))!.jobs.every((j) => !j.encryptedPayload));
    } finally { await f.database.close(); }
});
test("isolated SQL serializes two signers' aggregate pixel budgets and rolls back the final over-budget submission", async () => {
    const f = await isolated();
    try {
        await f.service.cancelEnvelope(actor, f.id);
        const fields: EsignDocumentInput["fields"] = [0, 1].flatMap((recipientIndex) => Array.from({ length: 3 }, (_, i) => ({ id: `image-${recipientIndex}-${i}`, recipientIndex, type: "signature", pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.1, required: true })));
        const document = await f.service.createDocument(actor, { title: "다자 예산", kind: "template", artifact: f.document.artifact, pages: f.document.pages, fields });
        const created = await f.service.createEnvelope(actor, { documentId: document.id, title: "SQL 픽셀 예산", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [0, 1].map((i) => ({ name: `가상 ${i}`, email: `fake-${i}@example.invalid`, channels: ["email" as const] })) });
        const id = created.envelope.id;
        await f.service.dispatchEnvelope(actor, id);
        const stored = (await f.repository.read(id))!;
        const tokens = stored.recipients.map((r) => f.service.decodeJob(stored.jobs.find((j) => j.kind === "invitation" && j.recipientId === r.id)!).token!);
        const inputs = await Promise.all(tokens.map(async (token, recipientIndex): Promise<SignatureInput> => {
            await f.service.requestOtp(token, "email");
            const otp = (await f.repository.read(id))!.jobs.find((j) => j.kind === "otp" && j.recipientId === stored.recipients[recipientIndex].id)!;
            const verified = await f.service.verifyOtp(token, f.service.decodeJob(otp).code!);
            return { verificationToken: verified.verificationToken, idempotencyKey: `sql-budget-${recipientIndex}`, consent: true, values: fields.filter((field) => field.recipientIndex === recipientIndex).map((field, i) => ({ fieldId: field.id, raster: { width: 1000, height: 2000 }, artifact: { key: `esign/signatures/${id}/${stored.recipients[recipientIndex].id}/${i}.png`, sha256: (recipientIndex * 10 + i + 1).toString(16).padStart(64, "0"), size: 500, contentType: "image/png" } })) };
        }));
        const before = (await f.repository.read(id))!;
        const results = await Promise.allSettled(tokens.map((token, i) => f.service.submitSignature(token, inputs[i])));
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.status, 413);
        const after = (await f.repository.read(id))!;
        assert.equal(after.envelope.version, before.envelope.version + 1);
        assert.equal(after.envelope.state, "pending");
        assert.equal(after.recipients.filter((r) => r.state === "signed").length, 1);
        assert.equal(after.events.filter((e) => e.type === "recipient.signed").length, 1);
        assert.equal(after.jobs.filter((j) => j.kind === "finalize").length, 0);
    } finally { await f.database.close(); }
});

test("UX-191/QA-02: 1,001건에서도 가장 오래된 계약을 제목·서명자 검색과 커서 페이지로 찾고 조직·사업 격리와 동률 정렬을 지킨다", async () => {
    const f = await isolated();
    try {
        // 가장 오래된 실제 계약(f.id, "SQL 검수"/"가상 서명자") 위에 더 최근 가상 계약 1,000건을 쌓는다. 30건씩 같은 created_at(동률).
        const bulk = (org: string, workspace: number, prefix: string, count: number) => f.database.query(`
            WITH rows AS (SELECT n, gen_random_uuid() AS id, gen_random_uuid() AS rid, (timestamptz '2026-10-18T02:00:00Z' + ((n / 30) * interval '1 minute')) AS at FROM generate_series(1, ${count}) n)
            , env AS (INSERT INTO esign.envelopes(id,org_id,workspace_id,version,state,expires_at,data,created_at)
                SELECT id, $1::uuid, $2, 1, 'pending', timestamptz '2026-12-01T00:00:00Z',
                    jsonb_build_object('id', id, 'orgId', $1::text, 'workspaceId', $2::int, 'title', $3 || ' 계약 ' || lpad(n::text, 4, '0'), 'order', 'parallel', 'state', 'pending', 'version', 1,
                        'expiresAt', '2026-12-01T00:00:00.000Z', 'createdBy', 'fixture', 'createdAt', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'updatedAt', to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        'document', jsonb_build_object('title', 'snapshot', 'fields', '[]'::jsonb)), at FROM rows RETURNING id)
            INSERT INTO esign.recipients(id,envelope_id,token_hash,data)
                SELECT rid, id, md5(rid::text) || md5(id::text), jsonb_build_object('id', rid, 'envelopeId', id, 'index', 0, 'name', $3 || ' 서명자 ' || lpad(n::text, 4, '0'), 'state', 'pending', 'channels', '["email"]'::jsonb, 'otpAttempts', 0, 'tokenHash', 'x')
                FROM rows`, [org, workspace, prefix]);
        await bulk(actor.orgId, actor.workspaceId, "대량", 1000);
        await bulk("00000000-0000-4000-8000-000000000099", actor.workspaceId, "다른조직", 50);
        await bulk(actor.orgId, 12, "다른사업", 50);

        const first = await f.service.listEnvelopes(actor, {});
        assert.equal(first.items.length, 50); assert.equal(first.total, 1001); assert.ok(first.nextCursor);
        const seen: string[] = []; let cursor: string | undefined;
        for (let pageNo = 0; pageNo < 20; pageNo++) {
            const page = await f.service.listEnvelopes(actor, { cursor, limit: 100 });
            seen.push(...page.items.map((item) => item.envelope.id));
            assert.ok(page.items.every((item) => item.envelope.orgId === actor.orgId && item.envelope.workspaceId === actor.workspaceId && item.recipients.length === 1));
            if (!page.nextCursor) break; cursor = page.nextCursor;
        }
        assert.equal(seen.length, 1001); assert.equal(new Set(seen).size, 1001, "동률 created_at에서도 중복·누락이 없다");
        const ordered = await f.database.query<{ id: string }>("SELECT id FROM esign.envelopes WHERE org_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC", [actor.orgId, actor.workspaceId]);
        assert.deepEqual(seen, ordered.rows.map((r) => r.id));
        assert.equal(seen.at(-1), f.id, "가장 오래된 계약은 1,001번째에 나온다");

        const byTitle = await f.service.listEnvelopes(actor, { query: "SQL 검수" });
        assert.deepEqual(byTitle.items.map((item) => item.envelope.id), [f.id]); assert.equal(byTitle.total, 1); assert.equal(byTitle.nextCursor, null);
        const bySigner = await f.service.listEnvelopes(actor, { query: "가상 서명자" });
        assert.deepEqual(bySigner.items.map((item) => item.envelope.id), [f.id]);
        assert.equal((await f.service.getEnvelope(actor, bySigner.items[0].envelope.id)).envelope.document.title, "격리 SQL 계약", "찾은 계약의 상세에 접근한다");
        assert.equal((await f.service.listEnvelopes(actor, { query: "대량 서명자 0001" })).total, 1);
        assert.equal((await f.service.listEnvelopes(actor, { query: "다른조직" })).total, 0);
        assert.equal((await f.service.listEnvelopes(actor, { query: "다른사업" })).total, 0);
        assert.equal((await f.service.listEnvelopes(actor, { query: "%" })).total, 0, "% 는 글자 그대로 찾는다");
        await assert.rejects(f.service.listEnvelopes(actor, { cursor: "broken" }), (e: Error & { code?: string }) => e.code === "invalid_cursor");

        // 문서: 최근 일반 업로드 120건이 템플릿을 밀어내지 않고, 템플릿만 서버에서 거른다.
        for (let i = 0; i < 120; i++) { f.advance(1000); await f.service.createDocument(actor, { title: `일반 업로드 ${i}`, kind: "document", artifact: f.document.artifact, pages: f.document.pages, fields: [] }); }
        const templates = await f.service.listDocuments(actor, { kind: "template" });
        assert.deepEqual(templates.items.map((d) => d.id), [f.document.id]); assert.equal(templates.total, 1);
        const documents = await f.service.listDocuments(actor, { kind: "document", limit: 100 });
        assert.equal(documents.items.length, 100); assert.equal(documents.total, 120);
        const rest = await f.service.listDocuments(actor, { kind: "document", limit: 100, cursor: documents.nextCursor! });
        assert.equal(rest.items.length, 20); assert.equal(rest.nextCursor, null);
        assert.equal(new Set([...documents.items, ...rest.items].map((d) => d.id)).size, 120);
        assert.equal((await f.service.listDocuments(actor, { query: "격리 SQL" })).items[0].id, f.document.id);
        assert.equal((await f.service.listDocuments({ ...actor, workspaceId: 12 }, {})).total, 0);
    } finally { await f.database.close(); }
});
