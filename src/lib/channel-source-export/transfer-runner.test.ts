import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fingerprint } from "@/lib/customer-imports/rules";
import { fileDescriptors } from "@/lib/customer-import-files/rules";
import type { ChannelFileManifest } from "./files";
import { createChannelTransferPlan, type ChannelTransferJobSnapshot } from "./transfer-plan";
import { runChannelFileTransfer, type ChannelTransferRunOptions, type ChannelTransferCheckpoint } from "./transfer-runner";

function fixture(count = 3, withSourceHash = true) {
    const bytes = Buffer.from("%PDF-1.4\nrunner synthetic bytes\n%%EOF"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const identity = { source: "channel" as const, channelId: "fictional-channel", workspaceId: 8, namespace: "fictional-export" };
    const messages = Array.from({ length: count }, (_, i) => ({ chatId: `chat-${i % 2}`, id: `message-${i}`, personType: "manager", options: i % 2 ? ["private"] : [], files: [{ id: "same-id", key: `key-${i}`, name: "same.pdf", size: bytes.length, ...(withSourceHash ? { sha256 } : {}) }] }));
    const bundle = { hasNext: false, messages };
    const manifest: ChannelFileManifest = { version: 1, source: "channel", apiVersion: "2026-06-01", channelId: identity.channelId, sourceFingerprint: fingerprint({ version: 1, channelId: identity.channelId, bundle }), sourceComplete: true, files: [], issues: [] };
    const jobs: ChannelTransferJobSnapshot[] = [0, 1].map(i => ({ job: { id: `job-${i}`, workspaceId: 8, source: "channel", namespace: identity.namespace, state: "completed", version: 4, fingerprint: fingerprint(`job-${i}`), rows: [], results: [] }, files: [], rowsComplete: true, filesComplete: true }));
    messages.forEach((message, i) => {
        const d = fileDescriptors(message.files)[0], kind = i % 2 ? "note" : "reply", job = jobs[i % 2];
        manifest.files.push({ id: fingerprint([message.chatId, message.id, d.sourceKey]), sourceKey: d.sourceKey, descriptorHash: d.manifest, kind, visibility: kind === "note" ? "private" : "public", state: "saved", attempts: 1, receipt: { path: `bytes/${sha256}.bin`, sha256, size: bytes.length } });
        job.job.rows.push({ index: i, kind: "messages", sourceId: `${message.chatId}/${message.id}`, data: { conversationId: message.chatId, messageKind: kind, files: message.files }, errors: [] });
        job.job.results.push({ position: i, targetId: String(100 + i) });
        job.files.push({ id: `target-${i}`, jobId: job.job.id, workspaceId: 8, messageId: 100 + i, sourceKey: d.sourceKey, manifest: d.manifest, fileName: d.name, state: "needs_source", active: true, metadataValid: true, version: 1, expectedSize: d.size, expectedSha256: d.sha, attachmentId: null, interrupted: false, locator: { ...d.locator, conversationId: message.chatId, messageSourceId: `${message.chatId}/${message.id}` } });
    });
    const plan = createChannelTransferPlan({ identity, bundle, manifest, jobs });
    const calls: string[] = [], checkpoints: ChannelTransferCheckpoint[] = [], stored = new Map<string, Buffer>();
    const options: ChannelTransferRunOptions = {
        approvedPlanSha256: plan.sha256,
        refreshJob: async id => structuredClone(jobs.find(row => row.job.id === id)!),
        readBytes: async () => Buffer.from(bytes),
        readTargetBytes: async file => Buffer.from(stored.get(file.attachmentId!)!),
        upload: async (item, body) => {
            const file = jobs.flatMap(job => job.files).find(row => row.id === item.target!.fileId)!;
            assert.equal(item.target!.version, file.version); assert.deepEqual(body, bytes);
            assert.equal(item.source.name, file.fileName); assert.equal(item.source.messageSourceId, file.locator.messageSourceId);
            calls.push(file.id); file.state = "ready"; file.version += 2; file.attachmentId = `attachment-${file.id}`;
            stored.set(file.attachmentId, Buffer.from(body));
            return structuredClone(file);
        },
        checkpoint: async state => { checkpoints.push(state); },
    };
    return { bytes, jobs, plan, options, calls, checkpoints, stored };
}
test("124개 다른 관계를 순차 업로드하고 원본 이름/버전/해시/메모 관계 유지", async () => {
    const f = fixture(124), result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.status, "complete"); assert.equal(result.counts.uploaded, 124);
    assert.equal(result.counts.uploadedBytesThisRun, f.bytes.length * 124);
    assert.deepEqual(f.calls, Array.from({ length: 124 }, (_, i) => `target-${i}`));
    assert.equal(f.jobs[1].job.rows[61].data.messageKind, "note");
    assert.equal(result.checkpoint.entries[123].fileId, "target-123");
});
test("검토 SHA 불일치 및 계획 변조는 API 호출 전에 거절", async () => {
    const f = fixture(); f.plan.items[0].target!.fileId = "other";
    await assert.rejects(runChannelFileTransfer(f.plan, f.options), /plan_not_approved/);
    assert.equal(f.calls.length, 0);
});
test("실행 중 외부의 plan 객체 변경은 이미 승인한 스냅샷에 영향 없음", async () => {
    const f = fixture(), read = f.options.readBytes;
    f.options.readBytes = async receipt => { f.plan.items[0].source.name = "mutated.pdf"; return read(receipt); };
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.status, "complete"); assert.equal(f.calls.length, 3);
});
test("검토 후 CAS 버전 또는 권한 변경은 후속 파일 전송 전에 중단", async () => {
    const f = fixture(); f.jobs[0].files[0].version++;
    const changed = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(changed.issue, "target_changed"); assert.equal(changed.counts.uploaded, 0); assert.equal(changed.counts.pending, 2);
    const g = fixture(); g.options.refreshJob = async () => { throw { status: 403 }; };
    const denied = await runChannelFileTransfer(g.plan, g.options);
    assert.equal(denied.issue, "permission_denied"); assert.equal(g.calls.length, 0);
});
test("실행 시 bytes 손상은 그 행을 실패로 보존하고 다른 파일만 처리하여 incomplete", async () => {
    const f = fixture(); let reads = 0;
    f.options.readBytes = async () => ++reads === 1 ? Buffer.from("wrong") : Buffer.from(f.bytes);
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.status, "incomplete"); assert.equal(result.counts.failed, 1); assert.equal(result.counts.uploaded, 2);
    assert.deepEqual(f.calls, ["target-1", "target-2"]);
});
test("업로드 응답 유실은 즉시 중단하고 재개 조회 ready를 재업로드하지 않음", async () => {
    const f = fixture(), upload = f.options.upload; let lost = true;
    f.options.upload = async (item, bytes) => { const result = await upload(item, bytes); if (lost) { lost = false; throw new Error("synthetic response lost"); } return result; };
    const interrupted = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(interrupted.status, "failed"); assert.equal(interrupted.counts.uncertain, 1); assert.equal(f.calls.length, 1);
    const resumed = await runChannelFileTransfer(f.plan, { ...f.options, resume: interrupted.checkpoint });
    assert.equal(resumed.status, "complete"); assert.equal(resumed.counts.alreadyReady, 1); assert.equal(resumed.counts.uploadedThisRun, 2);
    assert.deepEqual(f.calls, ["target-0", "target-1", "target-2"]);
});
test("성공 한 건 뒤 중단/재개 및 완료 checkpoint 재실행은 중복 0", async () => {
    const f = fixture(), controller = new AbortController(), upload = f.options.upload;
    f.options.upload = async (item, bytes) => { const result = await upload(item, bytes); controller.abort(); return result; };
    const first = await runChannelFileTransfer(f.plan, { ...f.options, signal: controller.signal });
    assert.equal(first.status, "aborted"); assert.equal(first.counts.uploaded, 1); assert.equal(first.counts.pending, 2);
    f.options.upload = upload;
    const second = await runChannelFileTransfer(f.plan, { ...f.options, resume: first.checkpoint });
    assert.equal(second.status, "complete"); assert.equal(second.counts.uploaded, 3);
    const third = await runChannelFileTransfer(f.plan, { ...f.options, resume: second.checkpoint });
    assert.equal(third.status, "complete"); assert.equal(third.counts.uploadedThisRun, 0); assert.equal(f.calls.length, 3);
});
test("업로드 전 checkpoint 저장 실패는 전송 0, 성공 후 저장 실패는 재개로 ready 확인", async () => {
    const f = fixture(); let saves = 0;
    f.options.checkpoint = async () => { if (++saves === 2) throw new Error("disk full"); };
    const before = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(before.issue, "checkpoint_failed"); assert.equal(f.calls.length, 0);
    const g = fixture(); let durable: ChannelTransferCheckpoint | undefined;
    g.options.checkpoint = async state => { if (state.entries[0].state === "uploaded") throw new Error("lost write"); durable = state; };
    const after = await runChannelFileTransfer(g.plan, g.options);
    assert.equal(after.issue, "checkpoint_failed"); assert.equal(g.calls.length, 1); assert.equal(durable!.entries[0].state, "uploading");
    const resumed = await runChannelFileTransfer(g.plan, { ...g.options, checkpoint: undefined, resume: durable });
    assert.equal(resumed.status, "complete"); assert.equal(resumed.counts.alreadyReady, 1); assert.equal(g.calls.length, 3);
});
test("서버 409/권한회수는 자동 재전송 없이 중단", async () => {
    for (const status of [409, 401, 403]) {
        const f = fixture(); let attempts = 0;
        f.options.upload = async () => { attempts++; throw { status }; };
        const result = await runChannelFileTransfer(f.plan, f.options);
        assert.equal(result.status, "failed"); assert.equal(attempts, 1); assert.equal(result.counts.pending, 2);
        assert.equal(result.issue, status === 409 ? "target_changed" : "permission_denied");
    }
});
test("업로드 결과가 다른 관계/비ready이면 완료를 주장하지 않음", async () => {
    const f = fixture(), upload = f.options.upload;
    f.options.upload = async (item, bytes) => ({ ...await upload(item, bytes), messageId: 999 });
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.status, "failed"); assert.equal(result.counts.uploaded, 0); assert.equal(result.counts.uncertain, 1);
});
test("잘못된 계획의 resume와 순서/대상 변조 checkpoint는 거절", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    const initial = await runChannelFileTransfer(f.plan, { ...f.options, signal: controller.signal });
    const bad = structuredClone(initial.checkpoint); bad.entries[0].fileId = "other";
    await assert.rejects(runChannelFileTransfer(f.plan, { ...f.options, resume: bad }), /invalid_resume/);
    bad.entries[0].fileId = initial.checkpoint.entries[0].fileId; bad.planSha256 = "0".repeat(64);
    await assert.rejects(runChannelFileTransfer(f.plan, { ...f.options, resume: bad }), /invalid_resume/);
    assert.equal(f.calls.length, 0);
});
test("SHA 없는 원본의 ready 경합: 같은 이름·크기 다른 바이트는 성공 확정하지 않음", async () => {
    const f = fixture(1, false), target = f.jobs[0].files[0], otherBytes = Buffer.from(f.bytes);
    otherBytes[15] ^= 1;
    f.options.readBytes = async () => {
        target.state = "ready"; target.version += 2; target.attachmentId = "other-client-attachment";
        f.stored.set(target.attachmentId, otherBytes);
        return Buffer.from(f.bytes);
    };
    let posts = 0;
    f.options.upload = async () => { posts++; return structuredClone(target); };
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(posts, 1); assert.equal(result.status, "failed");
    assert.equal(result.issue, "target_bytes_mismatch");
    assert.equal(result.counts.uploaded, 0); assert.equal(result.counts.confirmedUploadedBytes, 0);
    assert.deepEqual(f.stored.get(target.attachmentId!), otherBytes);
});
test("ready 경합에서 같은 bytes면 내용은 확인하지만 신규 생성 수를 추정하지 않음", async () => {
    const f = fixture(1, false), target = f.jobs[0].files[0];
    f.options.readBytes = async () => {
        target.state = "ready"; target.version += 2; target.attachmentId = "other-client-same-bytes";
        f.stored.set(target.attachmentId, Buffer.from(f.bytes)); return Buffer.from(f.bytes);
    };
    f.options.upload = async () => structuredClone(target);
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.status, "complete"); assert.equal(result.counts.targetVerified, 1);
    assert.equal(result.counts.verifiedTargetBytes, f.bytes.length); assert.equal(result.counts.newAttachmentsCreated, null);
    assert.ok(result.limitations.some(text => text.includes("새 첨부 생성 수는 알 수 없습니다")));
});
test("기존 ready도 actual bytes가 다르면 재전송 없이 실패", async () => {
    const f = fixture(1, false), target = f.jobs[0].files[0], wrong = Buffer.from(f.bytes);
    target.state = "ready"; target.version += 2; target.attachmentId = "preexisting";
    wrong[0] ^= 1; f.stored.set(target.attachmentId, wrong);
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.issue, "target_bytes_mismatch"); assert.equal(f.calls.length, 0);
    assert.equal(result.counts.targetVerified, 0); assert.equal(result.counts.alreadyReady, 0);
});
test("보호 다운로드 검증 콜백 없음/권한 회수는 완료로 처리하지 않음", async () => {
    const f = fixture(1);
    await assert.rejects(runChannelFileTransfer(f.plan, { ...f.options, readTargetBytes: undefined as unknown as ChannelTransferRunOptions["readTargetBytes"] }), /target_verifier_required/);
    assert.equal(f.calls.length, 0);
    f.options.readTargetBytes = async () => { throw { status: 403 }; };
    const result = await runChannelFileTransfer(f.plan, f.options);
    assert.equal(result.issue, "permission_denied"); assert.equal(result.counts.uploaded, 0);
    assert.equal(result.counts.targetVerified, 0); assert.equal(f.calls.length, 1);
});
