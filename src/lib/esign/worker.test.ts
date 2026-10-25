import assert from "node:assert/strict";
import test from "node:test";
import { EsignService } from "./core";
import { MemoryEsignRepository } from "./memory-repository";
import { processEsignJobs } from "./worker";
import type { EsignStorage } from "./storage";

async function fixture() {
    const actor = { orgId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", name: "가상 직원", workspaceId: 101 };
    const service = new EsignService({ repository: new MemoryEsignRepository(), secret: "fake-worker-regression-secret-at-least-32-characters" });
    const document = await service.createDocument(actor, { title: "가상 계약", kind: "document", artifact: { key: "esign/fake/source.pdf", sha256: "a".repeat(64), size: 10, contentType: "application/pdf" }, pages: [{ pageIndex: 0, width: 600, height: 800, rotation: 0, crop: { x: 0, y: 0, width: 600, height: 800 } }], fields: [{ id: "signature", recipientIndex: 0, type: "signature", pageIndex: 0, x: .1, y: .1, width: .2, height: .1, required: true }] });
    const detail = await service.createEnvelope(actor, { documentId: document.id, title: "가상 계약", order: "parallel", expiresAt: new Date(Date.now() + 86400000).toISOString(), recipients: [{ name: "가상 고객", email: "fake@isolated.example.test", channels: ["email"] }] });
    await service.dispatchEnvelope(actor, detail.envelope.id);
    let sends = 0;
    const delivery = { async ready() { return true; }, async send() { sends++; return { state: "accepted" as const, providerId: "fake-only" }; } };
    const storage = { async put() { throw new Error("unexpected file write"); }, async get() { throw new Error("unexpected file read"); } } as EsignStorage;
    return { actor, service, id: detail.envelope.id, delivery, storage, sends: () => sends };
}

test("worker does not send an invitation cancelled after claim and before transport", async () => {
    const f = await fixture(), claim = f.service.claimJob.bind(f.service); let injected = false;
    f.service.claimJob = async lease => { const job = await claim(lease); if (job && !injected) { injected = true; await f.service.cancelEnvelope(f.actor, f.id); } return job; };
    await processEsignJobs(f.service, f.storage, f.delivery);
    assert.equal(f.sends(), 0); assert.equal((await f.service.getEnvelope(f.actor, f.id)).envelope.state, "cancelled");
});
test("worker does not send a request whose deadline passed after claim", async () => {
    const f = await fixture(), claim = f.service.claimJob.bind(f.service); let injected = false;
    f.service.claimJob = async lease => {
        const job = await claim(lease);
        if (job && !injected) { injected = true; await f.service.repository.mutate(f.id, value => { value.envelope.expiresAt = new Date(Date.now() - 1).toISOString(); }); }
        return job;
    };
    await processEsignJobs(f.service, f.storage, f.delivery);
    assert.equal(f.sends(), 0);
    const aggregate = (await f.service.repository.read(f.id))!; assert.equal(aggregate.jobs[0].state, "failed");
});
test("worker still sends an active claimed request exactly once", async () => {
    const f = await fixture(); await processEsignJobs(f.service, f.storage, f.delivery); await processEsignJobs(f.service, f.storage, f.delivery);
    assert.equal(f.sends(), 1); assert.equal((await f.service.repository.read(f.id))!.jobs[0].state, "accepted");
});
test("UX-266: payload decode failure is recorded as failed before transport", async () => {
    const f = await fixture();
    f.service.decodeJob = () => { throw new Error("fake damaged ciphertext"); };
    await processEsignJobs(f.service, f.storage, f.delivery);
    assert.equal(f.sends(), 0);
    assert.equal((await f.service.repository.read(f.id))!.jobs[0].state, "failed");
});
test("worker does not deliver a code superseded after its claim", async () => {
    const f = await fixture(), stored = (await f.service.repository.read(f.id))!;
    const token = f.service.decodeJob(stored.jobs.find(job => job.kind === "invitation")!).token!;
    await f.service.requestOtp(token, "email");
    const claim = f.service.claimJob.bind(f.service); let injected = false;
    f.service.claimJob = async lease => {
        const job = await claim(lease);
        if (job?.kind === "otp" && !injected) {
            injected = true;
            await f.service.repository.mutate(f.id, value => { value.recipients[0].otpRetryAt = new Date(Date.now() - 1).toISOString(); });
            await f.service.requestOtp(token, "email");
        }
        return job;
    };
    await processEsignJobs(f.service, f.storage, f.delivery, 1);
    assert.equal(injected, true); assert.equal(f.sends(), 0);
    assert.equal((await f.service.repository.read(f.id))!.jobs.find(job => job.kind === "otp")!.state, "failed");
});


test("UX-266: 손상 OTP는 claim에서 failed로 종결하고 lease 만료 후에도 공급자 호출 0회", async () => {
    const f = await fixture(), stored = (await f.service.repository.read(f.id))!;
    const token = f.service.decodeJob(stored.jobs.find(job => job.kind === "invitation")!).token!;
    await f.service.requestOtp(token, "email");
    await f.service.repository.mutate(f.id, value => {
        value.jobs.find(job => job.kind === "otp")!.encryptedPayload = "corrupt-test-ciphertext";
        value.jobs.find(job => job.kind === "invitation")!.state = "accepted";
    });
    await processEsignJobs(f.service, f.storage, f.delivery, 1);
    const aggregate = (await f.service.repository.read(f.id))!, job = aggregate.jobs.find(job => job.kind === "otp")!;
    assert.equal(job.state, "failed"); assert.match(job.error!, /보내지 않았습니다/);
    assert.equal(job.leaseId, undefined); assert.equal(job.leaseUntil, undefined); assert.equal(job.encryptedPayload, undefined);
    assert.equal(aggregate.events.filter(e => e.type === "delivery.result").length, 1);
    assert.equal(await f.service.repository.claimJob(new Date(Date.now() + 120001).toISOString(), new Date(Date.now() + 240001).toISOString(), "fake-next-lease"), null);
    await processEsignJobs(f.service, f.storage, f.delivery, 1);
    assert.equal(f.sends(), 0);
    assert.equal((await f.service.repository.read(f.id))!.jobs.find(job => job.kind === "otp")!.state, "failed");
});


test("손상 OTP 다음 유효 초대 작업도 같은 배치에서 진행", async () => {
    const f = await fixture(), stored = (await f.service.repository.read(f.id))!;
    await f.service.requestOtp(f.service.decodeJob(stored.jobs[0]).token!, "email");
    await f.service.repository.mutate(f.id, value => { value.jobs.find(job => job.kind === "otp")!.encryptedPayload = "corrupt"; });
    await processEsignJobs(f.service, f.storage, f.delivery, 1);
    const jobs = (await f.service.repository.read(f.id))!.jobs;
    assert.equal(jobs.find(j => j.kind === "otp")!.state, "failed");
    assert.equal(jobs.find(j => j.kind === "invitation")!.state, "accepted");
    assert.equal(f.sends(), 1);
});

test("정상 OTP 접수와 전송 뒤 타임아웃의 unknown은 유지", async t => {
    for (const timeout of [false, true]) await t.test(String(timeout), async () => {
        const f = await fixture(), stored = (await f.service.repository.read(f.id))!;
        await f.service.requestOtp(f.service.decodeJob(stored.jobs[0]).token!, "email");
        await f.service.repository.mutate(f.id, value => { value.jobs.find(job => job.kind === "invitation")!.state = "accepted"; });
        let calls = 0;
        const delivery = { async ready() { return true; }, async send() { calls++; if (timeout) throw Error("fake response lost"); return {state: "accepted" as const, providerId: "fake"}; } };
        await processEsignJobs(f.service, f.storage, delivery, 1);
        await processEsignJobs(f.service, f.storage, delivery, 1);
        assert.equal(calls, 1);
        assert.equal((await f.service.repository.read(f.id))!.jobs.find(j => j.kind === "otp")!.state, timeout ? "unknown" : "accepted");
    });
});
