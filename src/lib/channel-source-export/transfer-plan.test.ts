import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fingerprint } from "@/lib/customer-imports/rules";
import { fileDescriptors } from "@/lib/customer-import-files/rules";
import type { ChannelFileManifest } from "./files";
import { createChannelTransferPlan, channelTransferPlanSha256, type ChannelTransferJobSnapshot } from "./transfer-plan";

function fixture(count = 3) {
    const bytes = Buffer.from("%PDF-1.4\nsynthetic identical bytes\n%%EOF"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const identity = { source: "channel" as const, channelId: "fictional-channel", workspaceId: 8, namespace: "fictional-export" };
    const messages = Array.from({ length: count }, (_, i) => ({ chatId: `chat-${i % 2}`, id: `message-${i}`, personType: "manager", options: i % 2 ? ["private"] : [], files: [{ id: "same-original-id", key: `provider-key-${i}`, name: "same-name.pdf", size: bytes.length, sha256, contentType: "application/pdf" }] }));
    const bundle = { hasNext: false, users: [], managers: [], bots: [], userChats: [{ id: "chat-0" }, { id: "chat-1" }], messages };
    const manifest: ChannelFileManifest = { version: 1, source: "channel", apiVersion: "2026-06-01", channelId: identity.channelId, sourceFingerprint: fingerprint({ version: 1, channelId: identity.channelId, bundle }), sourceComplete: true, files: [], issues: [] };
    const jobs: ChannelTransferJobSnapshot[] = [0, 1].map(i => ({ job: { id: `job-${i}`, workspaceId: 8, source: "channel", namespace: identity.namespace, state: "completed", version: 4, fingerprint: fingerprint(`job-${i}`), rows: [], results: [] }, files: [], rowsComplete: true, filesComplete: true }));
    messages.forEach((message, i) => {
        const d = fileDescriptors(message.files)[0], kind = i % 2 ? "note" : "reply", job = jobs[i % 2];
        manifest.files.push({ id: fingerprint([message.chatId, message.id, d.sourceKey]), sourceKey: d.sourceKey, descriptorHash: d.manifest, kind, visibility: kind === "note" ? "private" : "public", state: "saved", attempts: 1, receipt: { path: `bytes/${sha256}.bin`, sha256, size: bytes.length } });
        job.job.rows.push({ index: i, kind: "messages", sourceId: `${message.chatId}/${message.id}`, data: { conversationId: message.chatId, messageKind: kind, files: message.files }, errors: [] });
        job.job.results.push({ position: i, targetId: String(100 + i) });
        job.files.push({ id: `target-file-${i}`, jobId: job.job.id, workspaceId: 8, messageId: 100 + i, sourceKey: d.sourceKey, manifest: d.manifest, fileName: d.name, state: "needs_source", active: true, metadataValid: true, version: 1, expectedSize: d.size, expectedSha256: d.sha, attachmentId: null, interrupted: false, locator: { ...d.locator, conversationId: message.chatId, messageSourceId: `${message.chatId}/${message.id}` } });
    });
    return { identity, bundle, manifest, jobs, bytes };
}
test("같은 이름·bytes·원본 file ID라도 상담/메시지 관계별로 유일 매칭하고 private note 보존", () => {
    const f = fixture(), before = structuredClone(f), plan = createChannelTransferPlan(f);
    assert.deepEqual(plan.items.map(row => [row.source.messageSourceId, row.target?.fileId, row.action]), [
        ["chat-0/message-0", "target-file-0", "upload"], ["chat-1/message-1", "target-file-1", "upload"], ["chat-0/message-2", "target-file-2", "upload"],
    ]);
    assert.equal(plan.items[1].source.visibility, "private"); assert.equal(plan.items[1].source.kind, "note");
    assert.equal(new Set(plan.items.map(row => row.id)).size, 3);
    assert.equal(new Set(plan.items.map(row => row.source.receipt?.path)).size, 1);
    assert.equal(plan.sha256, channelTransferPlanSha256(plan)); assert.deepEqual(structuredClone(f), before);
});
test("124개 파일과 두 작업의 마지막 관계까지 보존", () => {
    const f = fixture(124), plan = createChannelTransferPlan(f);
    assert.equal(plan.items.filter(row => row.action === "upload").length, 124);
    assert.deepEqual(plan.items.map(row => row.target?.fileId), Array.from({ length: 124 }, (_, i) => `target-file-${i}`));
    assert.equal(plan.items[123].source.messageSourceId, "chat-1/message-123");
});
test("원본 이름만 같은 대상에는 연결하지 않고 후보 중복도 차단", () => {
    const f = fixture(); f.jobs[0].files[0].locator.messageSourceId = "somewhere/else";
    let plan = createChannelTransferPlan(f);
    assert.deepEqual(plan.items[0].issues, ["target_missing"]); assert.equal(plan.items[0].action, "blocked");
    const g = fixture(); g.jobs[0].files.push({ ...g.jobs[0].files[0], id: "duplicate-target" });
    plan = createChannelTransferPlan(g); assert.ok(plan.items[0].issues.includes("ambiguous_target"));
});
test("이전 원본은 보충하지 않고 활성 최신 원본 하나만 선택", () => {
    const f = fixture(); f.jobs[0].files[0].active = false;
    assert.ok(createChannelTransferPlan(f).items[0].issues.includes("previous_source"));
    f.jobs[0].files.push({ ...f.jobs[0].files[0], id: "active-version", active: true });
    assert.equal(createChannelTransferPlan(f).items[0].target?.fileId, "active-version");
});
test("key/index/지문/크기/해시 중 하나만 달라도 업로드 차단", () => {
    for (const change of [
        (f: ReturnType<typeof fixture>) => { f.jobs[0].files[0].locator.key = "other-key"; },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].files[0].locator.index = 1; },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].files[0].manifest = "0".repeat(64); },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].files[0].expectedSize!++; },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].files[0].expectedSha256 = "0".repeat(64); },
    ]) { const f = fixture(); change(f); assert.ok(createChannelTransferPlan(f).items[0].issues.includes("target_metadata_mismatch")); }
});
test("다른 사업/namespace/source와 미완료 페이지 snapshot은 전역 차단", () => {
    for (const change of [
        (f: ReturnType<typeof fixture>) => { f.jobs[0].job.workspaceId = 9; },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].job.namespace = "other"; },
        (f: ReturnType<typeof fixture>) => { f.jobs[0].job.source = "portable"; },
        (f: ReturnType<typeof fixture>) => { (f.jobs[0] as unknown as { filesComplete: boolean }).filesComplete = false; },
    ]) { const f = fixture(); change(f); const plan = createChannelTransferPlan(f); assert.ok(plan.issues.length); assert.ok(plan.items.every(row => row.action === "blocked")); }
});
test("메모를 답변으로 바꾼 job 또는 다른 대상 메시지 결과는 차단", () => {
    const f = fixture(); f.jobs[1].job.rows[0].data.messageKind = "reply";
    assert.ok(createChannelTransferPlan(f).items[1].issues.includes("message_visibility_mismatch"));
    const g = fixture(); g.jobs[0].job.results[0].targetId = "999";
    assert.ok(createChannelTransferPlan(g).items[0].issues.includes("message_relation_mismatch"));
});
test("백업 원본 지문/receipt 정보/누락/로컬 손상을 명시 처리", () => {
    const f = fixture(); f.manifest.sourceFingerprint = "0".repeat(64);
    assert.throws(() => createChannelTransferPlan(f), /manifest_mismatch/);
    const g = fixture(); g.manifest.files[0].receipt!.size++;
    assert.ok(createChannelTransferPlan(g).items[0].issues.includes("receipt_metadata_mismatch"));
    const h = fixture(); h.manifest.files.splice(0, 1);
    assert.ok(createChannelTransferPlan(h).items[0].issues.includes("receipt_missing"));
    const j = fixture(); const plan = createChannelTransferPlan({ ...j, localIssues: [{ id: j.manifest.files[0].id, code: "stored_sha_mismatch" }] });
    assert.equal(plan.items[0].action, "blocked"); assert.ok(plan.items[0].issues.includes("stored_sha_mismatch")); assert.equal(plan.items[1].action, "upload");
});
test("원본에서 사라진 manifest 파일과 중복 원본은 전역 차단", () => {
    const f = fixture(); f.bundle.messages.pop(); f.manifest.sourceFingerprint = fingerprint({ version: 1, channelId: f.identity.channelId, bundle: f.bundle });
    assert.ok(createChannelTransferPlan(f).issues.includes("manifest_source_missing"));
    const g = fixture(); g.bundle.messages.push(g.bundle.messages[0]); g.manifest.sourceFingerprint = fingerprint({ version: 1, channelId: g.identity.channelId, bundle: g.bundle });
    assert.ok(createChannelTransferPlan(g).issues.includes("duplicate_source"));
});
test("ready는 별도 skip 계획, attachment 없는 ready 및 fetching은 차단", () => {
    const f = fixture(); f.jobs[0].files[0].state = "ready"; f.jobs[0].files[0].attachmentId = "existing-attachment";
    assert.equal(createChannelTransferPlan(f).items[0].action, "already_ready");
    f.jobs[0].files[0].attachmentId = null;
    assert.ok(createChannelTransferPlan(f).items[0].issues.includes("invalid_ready_target"));
    f.jobs[0].files[0].state = "fetching"; f.jobs[0].files[0].interrupted = true;
    assert.ok(createChannelTransferPlan(f).items[0].issues.includes("target_fetching"));
});
test("출처 파일 SHA 목록은 승인 계획 hash에 포함되고 입력은 공유되지 않음", () => {
    const f = fixture(), sourceSnapshot = [{ path: "manifest.json", sha256: "1".repeat(64), size: 17 }];
    const plan = createChannelTransferPlan({ ...f, sourceSnapshot });
    sourceSnapshot[0].sha256 = "2".repeat(64);
    assert.equal(plan.sourceSnapshot[0].sha256, "1".repeat(64));
    assert.notEqual(createChannelTransferPlan({ ...f, sourceSnapshot }).sha256, plan.sha256);
});
test("같은 메시지 안의 반복 파일 ID는 occurrence/sourceKey/index로 각각 연결", () => {
    const f = fixture(1), message = f.bundle.messages[0];
    message.files.push({ ...message.files[0] });
    const d = fileDescriptors(message.files)[1];
    f.manifest.files.push({ ...f.manifest.files[0], id: fingerprint([message.chatId, message.id, d.sourceKey]), sourceKey: d.sourceKey, descriptorHash: d.manifest });
    f.manifest.sourceFingerprint = fingerprint({ version: 1, channelId: f.identity.channelId, bundle: f.bundle });
    f.jobs[0].files.push({ ...f.jobs[0].files[0], id: "second-occurrence", sourceKey: d.sourceKey, manifest: d.manifest, locator: { ...d.locator, conversationId: message.chatId, messageSourceId: `${message.chatId}/${message.id}` } });
    const plan = createChannelTransferPlan(f);
    assert.deepEqual(plan.items.map(row => [row.action, row.target?.fileId, row.source.locator.index]), [["upload", "target-file-0", 0], ["upload", "second-occurrence", 1]]);
    assert.notEqual(plan.items[0].source.sourceKey, plan.items[1].source.sourceKey);
});
test("실행 mode/origin은 계획 hash에 묶고 온라인 URL 자격정보/경로를 거절", () => {
    const f = fixture();
    const a = createChannelTransferPlan({ ...f, targetBinding: { mode: "online-api", origin: "https://a.example.test" } });
    const b = createChannelTransferPlan({ ...f, targetBinding: { mode: "online-api", origin: "https://b.example.test" } });
    const offline = createChannelTransferPlan({ ...f, targetBinding: { mode: "offline-fixture", origin: "offline-contract" } });
    assert.notEqual(a.sha256, b.sha256); assert.notEqual(a.sha256, offline.sha256);
    for (const origin of ["https://a.example.test/path", "https://user:password@a.example.test", "file:///tmp/demo", "https://a.example.test/"])
        assert.throws(() => createChannelTransferPlan({ ...f, targetBinding: { mode: "online-api", origin } }), /invalid_target_binding/);
});
