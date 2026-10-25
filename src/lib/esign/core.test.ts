import assert from "node:assert/strict";
import { test } from "node:test";
import { EsignService } from "./core";
import { MemoryEsignRepository } from "./memory-repository";
import { decryptPayload, encryptPayload } from "./crypto";
import { EsignError, type EsignActor, type EsignArtifact, type EsignDocumentInput, type EsignJob, type SignatureInput } from "./types";

const secret = "isolated-esign-test-secret-with-32-characters-minimum";
const actor: EsignActor = { orgId: "00000000-0000-4000-8000-000000000001", workspaceId: 1, userId: "00000000-0000-4000-8000-000000000002", name: "가상 직원" };
const source: EsignArtifact = { key: "esign/documents/isolated/source.pdf", sha256: "a".repeat(64), size: 1000, contentType: "application/pdf" };
function documentInput(count = 1): EsignDocumentInput {
    return { title: "가상 계약", kind: "template", artifact: source, pages: [{ pageIndex: 0, width: 600, height: 800, rotation: 0, crop: { x: 0, y: 0, width: 600, height: 800 } }], fields: Array.from({ length: count }, (_, index) => ({ id: `signature-${index}`, recipientIndex: index, type: "signature", pageIndex: 0, x: 0.1, y: 0.1 + index * 0.1, width: 0.2, height: 0.08, required: true })) };
}
async function fixture(options: { count?: number; order?: "parallel" | "sequential"; both?: boolean; repository?: MemoryEsignRepository; fields?: EsignDocumentInput["fields"] } = {}) {
    let time = new Date("2026-10-18T01:00:00.000Z");
    const repository = options.repository ?? new MemoryEsignRepository(), service = new EsignService({ repository, secret, clock: () => new Date(time) });
    const doc = await service.createDocument(actor, { ...documentInput(options.count ?? 1), ...(options.fields ? { fields: options.fields } : {}) });
    const created = await service.createEnvelope(actor, { documentId: doc.id, title: "가상 계약 서명", expiresAt: "2026-10-19T01:00:00.000Z", order: options.order ?? "parallel", recipients: Array.from({ length: options.count ?? 1 }, (_, i) => ({ name: `가상 고객 ${i}`, email: `fake-${i}@example.invalid`, phone: "+821000000000", channels: options.both ? ["email", "sms"] : ["email"] })) });
    const id = created.envelope.id, stored = (await repository.read(id))!;
    const tokens = stored.recipients.map((r) => service.decodeJob(stored.jobs.find((j) => j.recipientId === r.id)!).token!);
    await service.dispatchEnvelope(actor, id);
    async function verify(index = 0) {
        await service.requestOtp(tokens[index], "email");
        const value = (await repository.read(id))!;
        const job = value.jobs.filter((j) => j.kind === "otp" && j.recipientId === value.recipients[index].id).at(-1)!;
        const code = service.decodeJob(job).code!;
        const result = await service.verifyOtp(tokens[index], code);
        return { ...result, code, job };
    }
    function signature(index: number, verificationToken: string, idempotencyKey = `submission-${index}`): SignatureInput {
        return { verificationToken, idempotencyKey, consent: true, values: [{ fieldId: `signature-${index}`, artifact: { key: `esign/signatures/${id}/${stored.recipients[index].id}/image.png`, sha256: "b".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } }] };
    }
    async function claimFinalize() {
        let job: EsignJob | null;
        for (let i = 0; i < 20; i++) {
            job = await service.claimJob();
            if (!job) return null;
            if (job.kind === "finalize") return job;
            await service.completeDelivery(job.id, id, job.leaseId!, { state: "accepted", providerId: "fake-accepted" });
        }
        return null;
    }
    return { service, repository, id, doc, tokens, stored, verify, signature, claimFinalize, setTime: (value: string) => { time = new Date(value); }, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
async function budgetFixture(fieldsPerRecipient: number, raster: { width: number; height: number }, size = 500, shared = false) {
    const fields: EsignDocumentInput["fields"] = [0, 1].flatMap((recipientIndex) => Array.from({ length: fieldsPerRecipient }, (_, i) => ({ ...documentInput().fields[0], id: `budget-${recipientIndex}-${i}`, recipientIndex })));
    const f = await fixture({ count: 2, fields });
    const sessions = await Promise.all([f.verify(0), f.verify(1)]);
    const inputs: SignatureInput[] = sessions.map((session, recipientIndex) => ({ verificationToken: session.verificationToken, idempotencyKey: `budget-submission-${recipientIndex}`, consent: true, values: Array.from({ length: fieldsPerRecipient }, (_, i) => ({ fieldId: `budget-${recipientIndex}-${i}`, raster, artifact: { key: `esign/signatures/${f.id}/${f.stored.recipients[recipientIndex].id}/${i}.png`, sha256: ((shared ? 0 : recipientIndex * 10) + i + 1).toString(16).padStart(64, "0"), size, contentType: "image/png" } })) }));
    return { ...f, inputs };
}

test("two delivery channels share a recipient and token; staff DTOs exclude credentials", async () => {
    const f = await fixture({ both: true }), value = (await f.repository.read(f.id))!;
    assert.equal(value.recipients.length, 1); assert.equal(value.jobs.length, 2);
    assert.equal(value.recipients[0].phone, "01000000000");
    assert.equal(f.service.decodeJob(value.jobs.find((j) => j.channel === "sms")!).phone, "01000000000");
    assert.equal(f.service.decodeJob(value.jobs[0]).token, f.service.decodeJob(value.jobs[1]).token);
    const staff = JSON.stringify(await f.service.getEnvelope(actor, f.id));
    assert(!staff.includes("tokenHash")); assert(!staff.includes("encryptedPayload")); assert(!staff.includes(f.tokens[0]));
    const stored = JSON.stringify(value); assert(!stored.includes(f.tokens[0]));
});

test("UX-192: exhausted PDF job can be retried once concurrently, without resending invitations", async () => {
    const f = await fixture(), verified = await f.verify();
    await f.service.submitSignature(f.tokens[0], f.signature(0, verified.verificationToken));
    for (let attempt = 0; attempt < 3; attempt++) {
        const job = await f.claimFinalize(); assert(job);
        await f.service.failFinalization(job.id, f.id, job.leaseId!); f.advance(60_001);
    }
    const before = (await f.repository.read(f.id))!;
    assert.equal(before.jobs.find(j => j.kind === "finalize")!.state, "failed");
    await assert.rejects(f.service.retryFinalization({ ...actor, orgId: "other-org" }, f.id), /찾을 수 없습니다/);
    await Promise.all([f.service.retryFinalization(actor, f.id), f.service.retryFinalization(actor, f.id)]);
    const after = (await f.repository.read(f.id))!;
    assert.equal(after.jobs.filter(j => j.kind === "finalize").length, 1);
    assert.equal(after.events.filter(e => e.type === "envelope.finalization_retried").length, 1);
    assert.deepEqual(after.recipients, before.recipients);
    assert.deepEqual(after.jobs.filter(j => j.kind === "invitation"), before.jobs.filter(j => j.kind === "invitation"));
    const job = await f.claimFinalize(); assert(job);
    await f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact: { ...source, key: "esign/completed/fake.pdf", sha256: "c".repeat(64) }, verified: true });
    const completed = await f.service.retryFinalization(actor, f.id);
    assert.equal(completed.envelope.state, "completed");
    assert.equal(completed.jobs.filter(j => j.kind === "completed").length, 1);
});
test("UX-192: pending, cancelled and unsigned requests cannot retry PDF creation", async () => {
    const f = await fixture();
    await assert.rejects(f.service.retryFinalization(actor, f.id), /다시 생성할 수 없는/);
    await f.service.cancelEnvelope(actor, f.id);
    await assert.rejects(f.service.retryFinalization(actor, f.id), /다시 생성할 수 없는/);
});
test("link alone cannot read source, sign or reuse an OTP; verification is session-bound", async () => {
    const f = await fixture(), first = await f.service.publicSession(f.tokens[0]);
    assert.equal(first.document, undefined); assert.equal(first.verified, false);
    await assert.rejects(f.service.submitSignature(f.tokens[0], f.signature(0, "x".repeat(43))), /확인 코드/);
    const verified = await f.verify();
    assert.equal((await f.service.publicSession(f.tokens[0], verified.verificationToken)).document?.artifact.sha256, source.sha256);
    await assert.rejects(f.service.verifyOtp(f.tokens[0], verified.code), /만료/);
    assert.equal((await f.service.publicSession(f.tokens[0])).document, undefined);
    f.advance(30 * 60000);
    await assert.rejects(f.service.submitSignature(f.tokens[0], f.signature(0, verified.verificationToken)), /확인 코드/);
});
test("OTP wrong attempts commit, cooldown/expiry apply and codes cannot cross recipients", async () => {
    const f = await fixture({ count: 2 }), one = await f.verify(0);
    const requested = await f.service.requestOtp(f.tokens[1], "email");
    await assert.rejects(f.service.requestOtp(f.tokens[1], "email"), (e: EsignError) => e.status === 429 && e.code === "cooldown" && /뒤 확인 코드를 다시 요청/.test(e.message) && e.details?.retryAt === requested.retryAt);
    // UX-304: 틀릴 때 남은 횟수를 알려 주고, 5번째에는 '만료'가 아니라 횟수 초과와 재요청 가능 시각을 알린다.
    for (let i = 0; i < 4; i++) await assert.rejects(f.service.verifyOtp(f.tokens[1], "wrong"), (e: EsignError) => e.code === "otp_invalid" && e.details?.remainingAttempts === 4 - i && e.message.includes(`${4 - i}번 더`));
    await assert.rejects(f.service.verifyOtp(f.tokens[1], "wrong"), (e: EsignError) => e.status === 429 && e.code === "otp_locked" && e.details?.retryAt === requested.expiresAt && /5번 잘못/.test(e.message) && !/만료/.test(e.message));
    assert.equal((await f.repository.read(f.id))!.recipients[1].otpAttempts, 5);
    assert.equal((await f.repository.read(f.id))!.recipients[1].otpRetryAt, requested.expiresAt, "재요청 가능 시각을 코드 만료 시각으로 올린다");
    f.advance(61000);
    // 60초 쿨다운이 지나도 코드 만료 전에는 재요청이 막히며, 같은 시각을 돌려준다(다른 채널로 요청해도 같은 서명자 제한).
    await assert.rejects(f.service.requestOtp(f.tokens[1], "email"), (e: EsignError) => e.code === "cooldown" && e.details?.retryAt === requested.expiresAt && /여러 번 잘못/.test(e.message) && /약 4분/.test(e.message));
    await assert.rejects(f.service.verifyOtp(f.tokens[1], one.code), (e: EsignError) => e.code === "otp_locked");
    f.advance(5 * 60000);
    await f.service.requestOtp(f.tokens[1], "email");
    f.advance(5 * 60000);
    await assert.rejects(f.service.verifyOtp(f.tokens[1], "000000"), /만료/);
});
test("mandatory signature and field ownership, consent and image prefix are enforced", async () => {
    const f = await fixture(), v = await f.verify();
    await assert.rejects(f.service.submitSignature(f.tokens[0], { ...f.signature(0, v.verificationToken), consent: false } as unknown as SignatureInput));
    await assert.rejects(f.service.submitSignature(f.tokens[0], { ...f.signature(0, v.verificationToken), values: [] }), /필수/);
    const cross = f.signature(0, v.verificationToken); cross.values[0].artifact!.key = "esign/signatures/other/other/image.png";
    await assert.rejects(f.service.submitSignature(f.tokens[0], cross), /이미지가 아닙니다/);
    const foreign = f.signature(0, v.verificationToken); foreign.values[0].fieldId = "other-field";
    await assert.rejects(f.service.submitSignature(f.tokens[0], foreign), /다른 서명자/);
    const doc = await f.service.createDocument(actor, { ...documentInput(), fields: [{ ...documentInput().fields[0], type: "name" }] });
    await assert.rejects(f.service.createEnvelope(actor, { documentId: doc.id, title: "무효 계약", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상", email: "fake@example.invalid", channels: ["email"] }] }), /필수 서명/);
});
test("concurrent duplicate submissions produce one signature and one completion job", async () => {
    const f = await fixture(), v = await f.verify(), input = f.signature(0, v.verificationToken);
    const results = await Promise.all([f.service.submitSignature(f.tokens[0], input), f.service.submitSignature(f.tokens[0], input)]);
    assert(results.every((r) => r.state === "finalizing"));
    const value = (await f.repository.read(f.id))!;
    assert.equal(value.events.filter((e) => e.type === "recipient.signed").length, 1);
    assert.equal(value.jobs.filter((j) => j.kind === "finalize").length, 1);
    const replayWithFreshObject = structuredClone(input);
    replayWithFreshObject.values[0].artifact!.key = replayWithFreshObject.values[0].artifact!.key.replace("image.png", "same-bytes-reuploaded.png");
    assert.equal((await f.service.submitSignature(f.tokens[0], replayWithFreshObject)).state, "finalizing");
    assert.equal((await f.repository.read(f.id))!.recipients[0].values?.[0].artifact?.key, input.values[0].artifact!.key);
    await assert.rejects(f.service.submitSignature(f.tokens[0], { ...input, idempotencyKey: "another-key" }), /수정/);
});
test("sequential requests queue only the active recipient and reject early authentication", async () => {
    const f = await fixture({ count: 2, order: "sequential" });
    assert((await f.service.publicSession(f.tokens[1])).waiting);
    await assert.rejects(f.service.requestOtp(f.tokens[1], "email"), /기다리고/);
    assert.equal((await f.repository.read(f.id))!.jobs.filter((j) => j.state === "pending").length, 1);
    const first = await f.verify(0); await f.service.submitSignature(f.tokens[0], f.signature(0, first.verificationToken));
    const value = (await f.repository.read(f.id))!;
    assert.equal(value.jobs.find((j) => j.kind === "invitation" && j.recipientId === value.recipients[1].id)?.state, "pending");
    const second = await f.verify(1); await f.service.submitSignature(f.tokens[1], f.signature(1, second.verificationToken));
    assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.state, "finalizing");
});
test("completion requires verified persisted output, separate source key/hash and a current lease", async () => {
    const f = await fixture(), verified = await f.verify();
    await f.service.submitSignature(f.tokens[0], f.signature(0, verified.verificationToken));
    const job = (await f.claimFinalize())!;
    assert(job);
    const input = await f.service.getFinalizationInput(job.id, f.id, job.leaseId!);
    assert.equal(input.document.artifact.sha256, source.sha256);
    assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.state, "finalizing");
    await assert.rejects(f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact: source, verified: true }), /原本|원본/);
    const artifact = { ...source, key: "esign/completed/isolated/final.pdf", sha256: "c".repeat(64) };
    await assert.rejects(f.service.finishEnvelope(job.id, f.id, "wrong-lease", { artifact, verified: true }), /권한/);
    await assert.rejects(f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact, verified: false } as unknown as Parameters<EsignService["finishEnvelope"]>[3]), /검증/);
    const done = await f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact, verified: true });
    assert.equal(done.envelope.state, "completed");
    assert.equal((await f.service.publicSession(f.tokens[0], verified.verificationToken)).finalArtifact?.sha256, artifact.sha256);
    assert.equal((await f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact, verified: true })).envelope.state, "completed");
});
test("finalize failure is bounded/retryable and never marks the envelope completed", async () => {
    const f = await fixture(), v = await f.verify();
    await f.service.submitSignature(f.tokens[0], f.signature(0, v.verificationToken));
    for (let attempt = 1; attempt <= 3; attempt++) {
        const job = (await f.claimFinalize())!;
        assert.equal(job.attempts, attempt);
        assert.equal((await f.service.failFinalization(job.id, f.id, job.leaseId!)).state, attempt === 3 ? "failed" : "pending");
        f.advance(60000);
    }
    assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.state, "finalizing");
    assert.equal(await f.service.claimJob(), null);
});
test("unknown delivery and expired delivery lease never retry; finalization lease can recover", async () => {
    const f = await fixture({ both: true });
    const first = (await f.service.claimJob())!;
    await f.service.completeDelivery(first.id, f.id, first.leaseId!, { state: "unknown" });
    const second = (await f.service.claimJob())!;
    f.advance(61000);
    assert.equal(await f.service.claimJob(), null);
    assert((await f.repository.read(f.id))!.jobs.every((j) => j.state === "unknown"));
    await assert.rejects(f.service.completeDelivery(second.id, f.id, second.leaseId!, { state: "accepted" }), /권한/);
    const v = await f.verify(); await f.service.submitSignature(f.tokens[0], f.signature(0, v.verificationToken));
    const final = (await f.claimFinalize())!; f.advance(61000);
    const recovered = (await f.service.claimJob())!;
    assert.equal(recovered.id, final.id); assert.notEqual(recovered.leaseId, final.leaseId);
});
test("cancel, rejection and expiry prevent later signatures and cancel delivery work", async () => {
    for (const terminal of ["cancel", "reject", "expire"] as const) {
        const f = await fixture(), v = await f.verify();
        if (terminal === "cancel") await f.service.cancelEnvelope(actor, f.id);
        if (terminal === "reject") await f.service.reject(f.tokens[0], { verificationToken: v.verificationToken, reason: "가상 검수" });
        if (terminal === "expire") f.setTime("2026-10-19T01:00:00.000Z");
        await assert.rejects(f.service.submitSignature(f.tokens[0], f.signature(0, v.verificationToken)));
        const session = await f.service.publicSession(f.tokens[0], v.verificationToken);
        assert.equal(session.envelope.state, terminal === "cancel" ? "cancelled" : terminal === "reject" ? "rejected" : "expired");
        assert.equal(session.document, undefined); assert.equal(await f.service.claimJob(), null);
        assert((await f.repository.read(f.id))!.jobs.every((j) => !j.encryptedPayload));
    }
});
test("document edits use optimistic versions and envelopes keep the original snapshot", async () => {
    const f = await fixture(), changed = await f.service.updateDocument(actor, f.doc.id, { title: "새 템플릿", fields: [{ ...f.doc.fields[0], x: 0.5 }], version: 1 });
    assert.equal(changed.version, 2);
    assert.equal((await f.service.getEnvelope(actor, f.id)).envelope.document.fields[0].x, 0.1);
    await assert.rejects(f.service.updateDocument(actor, f.doc.id, { title: "낡은 편집", version: 1 }), /변경/);
    await assert.rejects(f.service.getEnvelope({ ...actor, workspaceId: 2 }, f.id), /찾을 수/);
});
test("delivery payload encryption authenticates binding and tampering", () => {
    const encrypted = encryptPayload(secret, { token: "fake-token" }, "job-1");
    assert.equal(decryptPayload<{ token: string }>(secret, encrypted, "job-1").token, "fake-token");
    assert.throws(() => decryptPayload(secret, encrypted, "job-2"));
    assert.throws(() => decryptPayload(secret, encrypted.slice(0, -4) + "xxxx", "job-1"));
});
test("public polling changes neither version, events, jobs nor OTP state", async () => {
    const f = await fixture(), v = await f.verify(), before = (await f.repository.read(f.id))!;
    await Promise.all(Array.from({ length: 10 }, () => f.service.publicSession(f.tokens[0], v.verificationToken)));
    const after = (await f.repository.read(f.id))!;
    assert.deepEqual(after, before);
});
test("completion notices keep the same signer link, enqueue once and erase retained invitation secrets", async () => {
    const f = await fixture({ both: true }), v = await f.verify();
    await f.service.submitSignature(f.tokens[0], f.signature(0, v.verificationToken));
    const job = (await f.claimFinalize())!;
    const artifact = { ...source, key: "esign/completed/isolated/final.pdf", sha256: "c".repeat(64) };
    await f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact, verified: true });
    await f.service.finishEnvelope(job.id, f.id, job.leaseId!, { artifact, verified: true });
    const value = (await f.repository.read(f.id))!;
    assert.equal(value.jobs.filter((j) => j.kind === "completed").length, 2);
    assert(value.jobs.filter((j) => j.kind === "invitation").every((j) => !j.encryptedPayload));
    for (let i = 0; i < 2; i++) {
        const notice = (await f.service.claimJob())!;
        assert.equal(notice.kind, "completed"); assert.equal(f.service.decodeJob(notice).token, f.tokens[0]);
        await f.service.completeDelivery(notice.id, f.id, notice.leaseId!, { state: i ? "failed" : "accepted" });
    }
    assert((await f.repository.read(f.id))!.jobs.every((j) => !j.encryptedPayload));
});
test("cancel removes encrypted links even from accepted, failed and unknown invitation jobs", async () => {
    for (const state of ["accepted", "failed", "unknown"] as const) {
        const f = await fixture(), job = (await f.service.claimJob())!;
        await f.service.completeDelivery(job.id, f.id, job.leaseId!, { state });
        assert((await f.repository.read(f.id))!.jobs[0].encryptedPayload);
        await f.service.cancelEnvelope(actor, f.id);
        assert((await f.repository.read(f.id))!.jobs.every((j) => !j.encryptedPayload));
    }
});
test("expired OTP jobs are cancelled before delivery and requests have bounded recipients/pages/fields", async () => {
    const f = await fixture();
    await f.service.requestOtp(f.tokens[0], "email"); f.advance(5 * 60000);
    const invitation = (await f.service.claimJob())!;
    assert.equal(invitation.kind, "invitation");
    await f.service.completeDelivery(invitation.id, f.id, invitation.leaseId!, { state: "accepted" });
    assert.equal(await f.service.claimJob(), null);
    assert.equal((await f.repository.read(f.id))!.jobs.find((j) => j.kind === "otp")?.state, "cancelled");
    await assert.rejects(f.service.createDocument(actor, { ...documentInput(), fields: [{ ...documentInput().fields[0], x: 0.99 }] }));
    await assert.rejects(f.service.createDocument(actor, { ...documentInput(), fields: [documentInput().fields[0], documentInput().fields[0]] }), /중복/);
    await assert.rejects(f.service.createEnvelope(actor, { documentId: f.doc.id, title: "과다 서명자", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: Array.from({ length: 6 }, () => ({ name: "가상", email: "fake@example.invalid", channels: ["email"] })) }));
});
test("name/date/text preserve their rasterized PNG; impossible calendar dates and oversize PNGs are rejected", async () => {
    const f = await fixture();
    const original = documentInput(), typed = await f.service.createDocument(actor, { ...original, fields: [...original.fields, { ...original.fields[0], id: "date", type: "date", y: 0.5 }] });
    const created = await f.service.createEnvelope(actor, { documentId: typed.id, title: "날짜 계약", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상", email: "fake@example.invalid", channels: ["email"] }] });
    await f.service.dispatchEnvelope(actor, created.envelope.id);
    const stored = (await f.repository.read(created.envelope.id))!, token = f.service.decodeJob(stored.jobs[0]).token!;
    await f.service.requestOtp(token, "email");
    const otp = (await f.repository.read(created.envelope.id))!.jobs.find((j) => j.kind === "otp")!;
    const v = await f.service.verifyOtp(token, f.service.decodeJob(otp).code!);
    const image: EsignArtifact = { key: `esign/signatures/${created.envelope.id}/${stored.recipients[0].id}/name.png`, sha256: "b".repeat(64), size: 500, contentType: "image/png" };
    const input: SignatureInput = { verificationToken: v.verificationToken, idempotencyKey: "typed-fields", consent: true, values: [{ fieldId: "signature-0", artifact: image, raster: { width: 100, height: 50 } }, { fieldId: "date", text: "2026-02-30", artifact: image, raster: { width: 100, height: 50 } }] };
    await assert.rejects(f.service.submitSignature(token, input), /올바른/);
    input.values[1].text = "2026-10-18"; input.values[0].artifact = { ...image, size: 1024 * 1024 + 1 };
    await assert.rejects(f.service.submitSignature(token, input));
    input.values[0].artifact = image;
    await f.service.submitSignature(token, input);
    assert.equal((await f.repository.read(created.envelope.id))!.recipients[0].values?.[1].artifact?.key, image.key);
});
test("bounded expiry cleanup erases retained invitation secrets without reopening or pending jobs", async () => {
    const f = await fixture(), job = (await f.service.claimJob())!;
    await f.service.completeDelivery(job.id, f.id, job.leaseId!, { state: "accepted" });
    f.setTime("2026-10-19T01:00:00.000Z");
    const before = (await f.repository.read(f.id))!;
    assert.equal((await f.service.listEnvelopes(actor)).items[0].envelope.state, "expired");
    assert.deepEqual((await f.repository.read(f.id))!, before, "List polling does not persist or scan mutations");
    assert.equal((await f.service.expireDue()).processed, 1);
    const after = (await f.repository.read(f.id))!;
    assert.equal(after.envelope.state, "expired");
    assert(after.jobs.every((j) => !j.encryptedPayload));
    assert.equal(after.events.filter((e) => e.type === "envelope.expired").length, 1);
    assert.equal((await f.service.expireDue()).processed, 0);
});
test("OTP overtakes older invitation backlog, then PDF work; live PDF lease still allows delivery and unknown is not retried", async () => {
    const repository = new MemoryEsignRepository();
    for (let i = 0; i < 8; i++) await fixture({ repository });
    const signer = await fixture({ repository }), v = await signer.verify();
    await signer.service.submitSignature(signer.tokens[0], signer.signature(0, v.verificationToken));
    const target = await fixture({ repository });
    target.advance(60000); await target.service.requestOtp(target.tokens[0], "email");
    const otp = (await target.service.claimJob())!;
    assert.equal(otp.kind, "otp"); assert.equal(otp.envelopeId, target.id);
    await target.service.completeDelivery(otp.id, target.id, otp.leaseId!, { state: "accepted" });
    const finalize = (await target.service.claimJob())!;
    assert.equal(finalize.kind, "finalize"); assert.equal(finalize.envelopeId, signer.id);
    const delivery = (await target.service.claimJob())!;
    assert.equal(delivery.kind, "invitation", "An active PDF lease must not block delivery");
    await target.service.completeDelivery(delivery.id, delivery.envelopeId, delivery.leaseId!, { state: "unknown" });
    const next = (await target.service.claimJob())!;
    assert.equal(next.kind, "invitation"); assert.notEqual(next.id, delivery.id);
    assert.equal((await repository.read(delivery.envelopeId))!.jobs.find((j) => j.id === delivery.id)?.attempts, 1);
});
test("two concurrent signers exceeding envelope pixel or byte budgets commit only one signature and return 413 before finalization", async () => {
    for (const kind of ["pixels", "bytes"] as const) {
        const f = kind === "pixels" ? await budgetFixture(3, { width: 1000, height: 2000 }) : await budgetFixture(5, { width: 100, height: 50 }, 1024 * 1024);
        const before = (await f.repository.read(f.id))!;
        const results = await Promise.allSettled([0, 1].map((i) => f.service.submitSignature(f.tokens[i], f.inputs[i])));
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.status, 413);
        const after = (await f.repository.read(f.id))!;
        assert.equal(after.envelope.version, before.envelope.version + 1);
        assert.equal(after.envelope.state, "pending");
        assert.equal(after.recipients.filter((r) => r.state === "signed").length, 1);
        assert.equal(after.events.filter((e) => e.type === "recipient.signed").length, 1);
        assert.equal(after.jobs.filter((j) => j.kind === "finalize").length, 0);
        assert.equal(after.recipients.find((r) => r.state === "pending")?.values, undefined);
    }
});
test("unique SHA images are counted once across signers at the exact 8M pixel and 8MiB byte boundaries", async () => {
    for (const kind of ["pixels", "bytes"] as const) {
        const f = kind === "pixels" ? await budgetFixture(4, { width: 1000, height: 2000 }, 500, true) : await budgetFixture(8, { width: 100, height: 50 }, 1024 * 1024, true);
        await Promise.all([0, 1].map((i) => f.service.submitSignature(f.tokens[i], f.inputs[i])));
        assert.equal((await f.repository.read(f.id))!.envelope.state, "finalizing");
    }
});
test("same SHA cannot claim different dimensions or byte counts; failed metadata changes roll back", async () => {
    for (const kind of ["raster", "size"] as const) {
        const f = await budgetFixture(1, { width: 100, height: 50 }, 500, true);
        await f.service.submitSignature(f.tokens[0], f.inputs[0]);
        if (kind === "raster") f.inputs[1].values[0].raster = { width: 50, height: 100 };
        else f.inputs[1].values[0].artifact!.size = 501;
        const before = (await f.repository.read(f.id))!;
        await assert.rejects(f.service.submitSignature(f.tokens[1], f.inputs[1]), (error: unknown) => (error as { code?: string }).code === "image_metadata_mismatch");
        assert.deepEqual(await f.repository.read(f.id), before);
    }
});
test("an exact signed replay is idempotent before aggregate policy checks, while its own metadata must stay consistent", async () => {
    const f = await budgetFixture(5, { width: 100, height: 50 });
    await f.service.submitSignature(f.tokens[0], f.inputs[0]);
    // Model a record saved under an earlier aggregate policy; its signed bytes must not be resubmitted.
    await f.repository.mutate(f.id, (a) => {
        a.recipients[1].state = "signed";
        a.recipients[1].values = f.inputs[1].values.map((v) => ({ ...v, raster: { width: 1000, height: 2000 } }));
        a.envelope.state = "finalizing";
    });
    const replay = structuredClone(f.inputs[0]);
    replay.values[0].artifact!.key = replay.values[0].artifact!.key.replace("0.png", "same-bytes.png");
    assert.equal((await f.service.submitSignature(f.tokens[0], replay)).state, "finalizing");
    assert.equal((await f.repository.read(f.id))!.events.filter((e) => e.type === "recipient.signed").length, 1);
    replay.values[0].raster = { width: 50, height: 100 };
    await assert.rejects(f.service.submitSignature(f.tokens[0], replay), /크기 정보/);
});

test("UX-189: 고객이 이미지를 만들 수 없는 가는 입력란은 저장·발송 전에 막고 정상 입력란과 기존 문서는 그대로 둔다", async () => {
    const repository = new MemoryEsignRepository(), service = new EsignService({ repository, secret, clock: () => new Date("2026-10-18T01:00:00.000Z") });
    const a4 = { pageIndex: 0, width: 595, height: 842, rotation: 0 as const, crop: { x: 0, y: 0, width: 595, height: 842 } };
    const thin = { id: "thin", recipientIndex: 0, type: "signature" as const, pageIndex: 0, x: 0, y: 0.5, width: 1, height: 0.02, required: true };
    // 기존(검증 이전) 문서는 그대로 저장돼 있다고 가정한다: 생성 경로는 자동 변경하지 않는다.
    const legacy = await service.createDocument(actor, { ...documentInput(), pages: [a4], fields: [thin] });
    assert.equal(legacy.fields[0].height, 0.02);
    const request = { documentId: legacy.id, title: "가는 서명란", order: "parallel" as const, expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상 고객", email: "fake@example.invalid", channels: ["email" as const] }] };
    await assert.rejects(service.createEnvelope(actor, request), (e: Error & { code?: string }) => e.code === "field_too_thin" && e.message.includes("1쪽 1번 서명자의 '서명'"));
    assert.equal((await repository.list(actor, {})).items.length, 0, "발송 작업이 만들어지지 않는다");
    await assert.rejects(service.updateDocument(actor, legacy.id, { fields: [thin], version: 1 }), /너무 가늘거나 납작/);
    const fixed = await service.updateDocument(actor, legacy.id, { fields: [{ ...thin, height: 0.07, width: 0.2 }], version: 1 });
    const created = await service.createEnvelope(actor, { ...request, documentId: fixed.id });
    assert.equal(created.envelope.state, "draft");
    // 가로 페이지의 세로 서명란처럼 정상 비율은 허용한다.
    const landscape = { ...a4, width: 842, height: 595, crop: { x: 0, y: 0, width: 842, height: 595 } };
    const tall = await service.createDocument(actor, { ...documentInput(), pages: [landscape], fields: [{ ...thin, width: 0.05, height: 0.3 }] });
    assert.equal((await service.createEnvelope(actor, { ...request, documentId: tall.id })).envelope.state, "draft");
});

test("UX-304: 1~4회 틀린 뒤 맞는 코드로 인증되고 횟수는 새 코드에서 초기화된다", async () => {
    const f = await fixture();
    await f.service.requestOtp(f.tokens[0], "email");
    for (let i = 0; i < 4; i++) await assert.rejects(f.service.verifyOtp(f.tokens[0], "111111"), /번 더 입력/);
    const value = (await f.repository.read(f.id))!, code = f.service.decodeJob(value.jobs.filter((j) => j.kind === "otp").at(-1)!).code!;
    assert.ok((await f.service.verifyOtp(f.tokens[0], code)).verificationToken);
});

test("UX-226: 실패·확인 필요 초대만 같은 링크로 다시 보내고 중복·순서·종료 상태를 막는다", async () => {
    const f = await fixture({ count: 2, order: "sequential" });
    const claim = async () => { const job = (await f.service.claimJob())!; assert.equal(job.kind, "invitation"); return job; };
    const first = await claim();
    await f.service.completeDelivery(first.id, f.id, first.leaseId!, { state: "failed", error: "주소 거절" });
    // 다른 조직·사업은 찾을 수 없다.
    await assert.rejects(f.service.resendInvitation({ ...actor, workspaceId: 2 }, f.id, { jobId: first.id }), /찾을 수 없습니다/);
    // 순차 서명에서 차례가 아닌 서명자의 초대는 다시 보낼 수 없다.
    const blocked = (await f.repository.read(f.id))!.jobs.find((j) => j.recipientId === f.stored.recipients[1].id)!;
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: blocked.id }), (e: EsignError) => e.code === "waiting");
    const resent = await f.service.resendInvitation(actor, f.id, { jobId: first.id });
    const invitations = resent.jobs.filter((j) => j.kind === "invitation" && j.recipientId === f.stored.recipients[0].id);
    assert.equal(invitations.length, 2); assert.equal(invitations[1].state, "pending");
    assert.equal(resent.events.filter((e) => e.type === "delivery.resent").length, 1);
    assert.equal(resent.events.find((e) => e.type === "delivery.resent")!.actorId, actor.userId);
    // 같은 실패 기록으로 다시 눌러도(중복 클릭·응답 유실) 대기 작업은 하나다.
    const again = await f.service.resendInvitation(actor, f.id, { jobId: first.id });
    assert.equal(again.jobs.filter((j) => j.kind === "invitation" && j.recipientId === f.stored.recipients[0].id).length, 2);
    // 새 작업은 같은 서명 링크를 담고, 이전 실패 작업의 암호 payload는 지운다.
    const stored = (await f.repository.read(f.id))!, nextJob = stored.jobs.find((j) => j.id === invitations[1].id)!;
    assert.equal(f.service.decodeJob(nextJob).token, f.tokens[0]);
    assert.equal(stored.jobs.find((j) => j.id === first.id)!.encryptedPayload, undefined);
    // 접수됨은 다시 보내지 않고, 확인 필요는 직원 확인 표시가 있어야 한다.
    const second = await claim();
    await f.service.completeDelivery(second.id, f.id, second.leaseId!, { state: "unknown", error: "응답 없음" });
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: first.id }), (e: EsignError) => e.code === "stale_job");
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: second.id }), (e: EsignError) => e.code === "confirm_required");
    const confirmed = await f.service.resendInvitation(actor, f.id, { jobId: second.id, confirmUnknown: true });
    const third = await claim(); assert.equal(f.service.decodeJob((await f.repository.read(f.id))!.jobs.find((j) => j.id === third.id)!).token, f.tokens[0]);
    await f.service.completeDelivery(third.id, f.id, third.leaseId!, { state: "accepted", providerId: "fake" });
    assert.equal(confirmed.events.filter((e) => e.type === "delivery.resent").length, 2);
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: third.id }), (e: EsignError) => e.code === "not_resendable");
    // 취소 뒤에는 거부한다.
    await f.service.cancelEnvelope(actor, f.id);
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: second.id, confirmUnknown: true }), (e: EsignError) => e.status === 409);
});

test("UX-226: 서명을 마친 서명자·만료·완료 요청은 다시 보내지 않고, 다시 보낸 링크로 완료 알림까지 이어진다", async () => {
    const f = await fixture();
    const job = (await f.service.claimJob())!;
    await f.service.completeDelivery(job.id, f.id, job.leaseId!, { state: "failed", error: "주소 거절" });
    await f.service.resendInvitation(actor, f.id, { jobId: job.id });
    const session = await f.verify(0);
    await f.service.submitSignature(f.tokens[0], f.signature(0, session.verificationToken));
    await assert.rejects(f.service.resendInvitation(actor, f.id, { jobId: job.id }), (e: EsignError) => e.status === 409);
    const finalize = await f.claimFinalize();
    await f.service.finishEnvelope(finalize!.id, f.id, finalize!.leaseId!, { artifact: { key: "esign/completed/x.pdf", sha256: "c".repeat(64), size: 900, contentType: "application/pdf" }, verified: true });
    const completed = (await f.repository.read(f.id))!.jobs.filter((j) => j.kind === "completed");
    assert.equal(completed.length, 1); assert.equal(f.service.decodeJob(completed[0]).token, f.tokens[0]);
    const late = await fixture();
    const lateJob = (await late.service.claimJob())!;
    await late.service.completeDelivery(lateJob.id, late.id, lateJob.leaseId!, { state: "failed" });
    late.advance(2 * 86400000);
    await assert.rejects(late.service.resendInvitation(actor, late.id, { jobId: lateJob.id }), (e: EsignError) => e.status === 410);
});

test("UX-262: 초대 작업 payload에 요청 조직명과 기한을 담고, 조직명을 모르면 생략한다", async () => {
    const repository = new MemoryEsignRepository(), service = new EsignService({ repository, secret, clock: () => new Date("2026-10-18T01:00:00.000Z") });
    const doc = await service.createDocument(actor, documentInput());
    const request = { documentId: doc.id, title: "가상 계약", order: "parallel" as const, expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상 고객", email: "fake@example.invalid", channels: ["email" as const] }] };
    const named = await service.createEnvelope({ ...actor, orgName: " 가상 상사 " }, request);
    const payload = service.decodeJob((await repository.read(named.envelope.id))!.jobs[0]);
    assert.equal(payload.orgName, "가상 상사"); assert.equal(payload.expiresAt, "2026-10-19T01:00:00.000Z");
    const unnamed = await service.createEnvelope(actor, request);
    assert.equal(service.decodeJob((await repository.read(unnamed.envelope.id))!.jobs[0]).orgName, undefined);
});
