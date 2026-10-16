import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createArchiveMigrationPlan, runArchiveMigration, type ArchiveMigrationClient, type ArchiveMigrationCheckpoint } from "./migration";
import type { loadArchiveMigrationSource } from "./migration-source";
import type { SendbImportFileDetail } from "../../../sdk/server";
import type { ArchiveStore } from "./store";
const bytes = Buffer.from("fictional immutable archive"), sha256 = createHash("sha256").update(bytes).digest("hex");
const stream = async function* (value: Uint8Array = bytes) { yield value.subarray(0, 4); yield value.subarray(4); };
function fixture() {
    const identity = { workspaceId: 8, namespace: "fixture", channelId: "fictional", origin: "https://sendb.example.test" }, storage = { endpoint: "https://storage.example.test", bucket: "fixture-private", region: "auto" };
    const sourceFile = { id: "a".repeat(64), messageSourceId: "chat/message", sourceFingerprint: "b".repeat(64), sourceKey: "c".repeat(64), descriptorHash: "d".repeat(64), name: "가상.bin", size: bytes.length, sha256, kind: "note", expectedSize: bytes.length, expectedSha256: sha256, locator: { originalId: "file", key: null, index: 0, conversationId: "chat", messageSourceId: "chat/message" } };
    const source = { files: [sourceFile], snapshot: { bundleSha256: "e".repeat(64), manifestSha256: "f".repeat(64) }, coverage: { scope: "reviewed-bundle-attachments", sourceCollectionComplete: false, messageSourceComplete: true, unavailableCustomerProfiles: 1, unavailableAuthorProfiles: 0 }, limitations: [], directory: "unused" } as Awaited<ReturnType<typeof loadArchiveMigrationSource>>;
    const current = { job: { id: "00000000-0000-4000-8000-000000000001", workspaceId: 8, source: "channel", namespace: "fixture", state: "completed", version: 4, fingerprint: "0".repeat(64) }, file: { id: "00000000-0000-4000-8000-000000000002", jobId: "00000000-0000-4000-8000-000000000001", workspaceId: 8, messageId: 9, sourceKey: sourceFile.sourceKey, manifest: sourceFile.descriptorHash, fileName: sourceFile.name, state: "needs_source", active: true, metadataValid: true, version: 1, attempts: 0, expectedSize: bytes.length, expectedSha256: sha256, sourceHost: null, interrupted: false, error: null, attachmentId: null, locator: sourceFile.locator }, message: { sourceId: sourceFile.messageSourceId, sourceFingerprint: sourceFile.sourceFingerprint, kind: "note", conversationId: "00000000-0000-4000-8000-000000000003" } } satisfies SendbImportFileDetail;
    const live: SendbImportFileDetail = structuredClone(current), counters = { puts: 0, attaches: 0, reads: 0 }, objects = new Map<string, Buffer>();
    const store: ArchiveStore = { async put(key, input) { counters.puts++; if (objects.has(key)) throw { $metadata: { httpStatusCode: 412 } }; const chunks = []; for await (const c of input.open()) chunks.push(c); objects.set(key, Buffer.concat(chunks)); }, async get(key) { const saved = objects.get(key); if (!saved) throw { $metadata: { httpStatusCode: 404 } }; return { size: saved.length, body: stream(saved) }; } };
    let loseResponse = false;
    const client: ArchiveMigrationClient = { imports: async () => ({ rows: [], hasMore: false }), importFiles: async () => ({ rows: [], counts: [], total: 0, offset: 0, hasMore: false }), importFile: async () => structuredClone(live), planArchiveImportFile: async (_j, _f, version, input) => ({ objectKey: `inbox-archive/00000000-0000-4000-8000-000000000004/8/${live.file.id}/${version}/${input.sha256}.bin`, fileName: live.file.fileName, size: input.size, sha256: input.sha256 }), connectArchiveImportFile: async () => { counters.attaches++; live.file.state = "ready"; live.file.version += 2; live.file.attachmentId = "00000000-0000-4000-8000-000000000005"; if (loseResponse) throw Error("lost after commit"); return structuredClone(live.file); } };
    const plan = createArchiveMigrationPlan(identity, storage, source, [current]);
    let checkpoint: ArchiveMigrationCheckpoint | undefined;
    const options = { approvedSha256: plan.sha256, client, store: () => store, openSource: () => ({ size: bytes.length, sha256, open: stream }), readTarget: async () => { counters.reads++; return stream(); }, persist: async (s: ArchiveMigrationCheckpoint) => { checkpoint = structuredClone(s); } };
    return { plan, source, current, live, options, counters, objects, lose: () => { loseResponse = true; }, get checkpoint() { return checkpoint; } };
}
test("private-object migration verifies bytes and resumes a lost commit response without another write", async () => {
    const f = fixture(); f.lose();
    const first = await runArchiveMigration(f.plan, f.options);
    assert.equal(first.status, "incomplete"); assert.equal(first.checkpoint.entries[0].state, "unknown");
    const resumed = await runArchiveMigration(f.plan, { ...f.options, resume: f.checkpoint });
    assert.equal(resumed.status, "complete"); assert.equal(resumed.sourceCollectionComplete, false);
    assert.equal(f.counters.puts, 1); assert.equal(f.counters.attaches, 1); assert.equal(f.counters.reads, 1);
});
test("changed CAS, original source, visibility or job scope stops before object writes", async () => {
    for (const mutate of [(d: SendbImportFileDetail) => d.file.version++, (d: SendbImportFileDetail) => { d.message.sourceFingerprint = "0".repeat(64); }, (d: SendbImportFileDetail) => { d.message.kind = "reply"; }, (d: SendbImportFileDetail) => d.job.workspaceId++]) {
        const f = fixture(); mutate(f.live); const result = await runArchiveMigration(f.plan, f.options);
        assert.equal(result.status, "incomplete"); assert.equal(f.counters.puts, 0); assert.equal(f.counters.attaches, 0);
    }
});
test("existing wrong object bytes are never overwritten or connected", async () => {
    const f = fixture(), target = await f.options.client.planArchiveImportFile(f.current.job.id, f.current.file.id, 1, f.source.files[0]);
    f.objects.set(target.objectKey, Buffer.alloc(bytes.length, 120));
    assert.equal((await runArchiveMigration(f.plan, f.options)).status, "incomplete");
    assert.equal(f.counters.puts, 0); assert.equal(f.counters.attaches, 0);
});
test("approval tampering and checkpoint failure cannot precede an upload", async () => {
    const f = fixture(); const changed = structuredClone(f.plan); changed.storage.bucket = "another-bucket";
    await assert.rejects(runArchiveMigration(changed, f.options), /plan_not_approved/);
    await assert.rejects(runArchiveMigration(f.plan, { ...f.options, persist: async () => { throw Error("disk unavailable"); } }));
    assert.equal(f.counters.puts, 0); assert.equal(f.counters.attaches, 0);
});
test("ready files are always downloaded and hashed, including a forged verified checkpoint", async () => {
    const f = fixture(); f.live.file.state = "ready"; f.live.file.version = 3; f.live.file.attachmentId = "00000000-0000-4000-8000-000000000005";
    const checkpoint = { version: 1, planSha256: f.plan.sha256, entries: [{ id: f.source.files[0].id, state: "verified", attachmentId: f.live.file.attachmentId }] };
    const result = await runArchiveMigration(f.plan, { ...f.options, resume: checkpoint, readTarget: async () => stream(Buffer.alloc(bytes.length, 1)) });
    assert.equal(result.status, "incomplete"); assert.equal(f.counters.puts, 0); assert.equal(f.counters.attaches, 0);
});
