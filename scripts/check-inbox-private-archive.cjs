/* eslint-disable @typescript-eslint/no-require-imports -- 소유한 로컬 S3 호환 서버와 가상 PostgreSQL만 사용 */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { randomUUID, createHash } = require("node:crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const S3rver = require(path.resolve(__dirname, "../.testenv/archive-storage-qa/node_modules/s3rver"));
const { runPostgresPlatformCheck } = require("./customer-platform-test-postgres.cjs");
async function scenario(ctx) {
    const { db, actor, otherActor, clients, channels } = ctx;
    const schema = require("../src/lib/db/schema.ts"), { eq, sql } = require("drizzle-orm");
    const repo = require("../src/lib/customer-import-files/repository.ts");
    const { downloadAttachmentStream, uploadAttachment } = require("../src/lib/inbox/files.ts");
    const { createArchiveStore } = require("../src/lib/inbox-archive-storage/store.ts");
    const target = path.resolve(__dirname, "../.testenv/private-archive-fixture-" + randomUUID());
    fs.mkdirSync(target);
    const server = new S3rver({ address: "127.0.0.1", port: 0, directory: target, silent: true, configureBuckets: [{ name: "fictional-private-archive" }] });
    const { port } = await server.run();
    const client = new S3Client({ region: "us-east-1", endpoint: "http://127.0.0.1:" + port, forcePathStyle: true, credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
    const store = createArchiveStore(client, "fictional-private-archive");
    ctx.archiveTest.store = store;
    const raw = Buffer.alloc(20 * 1024 * 1024 + 1, 117), sha256 = createHash("sha256").update(raw).digest("hex");
    const source = { size: raw.length, sha256, open: async function* () { for (let at = 0; at < raw.length; at += 65536) yield raw.subarray(at, at + 65536); } };
    async function complete(namespace, kind = "reply") {
        let job = await clients.dh.previewImport({ workspaceId: 8, source: "portable", namespace, format: "json", content: JSON.stringify({ contacts: [{ id: "c", name: "가상 보관 고객" }], conversations: [{ id: "chat", name: "가상 보관 상담", contactId: "c", createdAt: "2024-01-01T00:00:00Z" }], messages: [{ id: "m", conversationId: "chat", body: "가상 보관 첨부", messageKind: kind, authorName: "가상 상담원", createdAt: "2024-01-01T00:00:01Z", files: [{ id: "f", name: "가상 대용량.bin", size: raw.length, sha256 }] }] }) });
        assert.deepEqual(job.errors, []);
        job = await clients.dh.changeImport(job.id, { action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true });
        while (job.state === "running") job = await clients.dh.stepImport(job.id, job.cursor);
        assert.equal(job.state, "completed");
        return (await clients.dh.importFiles(job.id)).rows[0];
    }
    const getTask = async id => (await db.select().from(schema.customerImportFiles).where(eq(schema.customerImportFiles.id, id)))[0];
    const scopeFor = async t => ({ orgId: actor.orgId, channelId: channels.dh.id, conversationId: (await db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, t.messageId)))[0].conversationId, ownerKey: "fictional-staff", publicOnly: false });
    async function hashBody(body) { const hash = createHash("sha256"); let size = 0; for await (const chunk of body) { size += chunk.length; hash.update(chunk); } return { size, sha256: hash.digest("hex") }; }
    try {
        let t = await complete("private-object-main");
        assert.equal(t.metadataValid, true);
        await assert.rejects(repo.transferImportFile(actor, t.jobId, t.id, t.version, { bytes: raw }, db), e => e.status === 413);
        let touched = 0;
        const forbiddenStore = { put: async () => { touched++; }, get: async () => { touched++; } };
        await assert.rejects(repo.transferArchivedImportFile(otherActor, t.jobId, t.id, t.version, source, db, forbiddenStore), e => [403, 404].includes(e.status));
        assert.equal(touched, 0);
        await assert.rejects(repo.transferArchivedImportFile(actor, t.jobId, t.id, t.version, { ...source, size: source.size - 1 }, db, forbiddenStore), e => e.status === 409);
        assert.equal(touched, 0);
        t = await getTask(t.id);
        const saved = await repo.transferArchivedImportFile(actor, t.jobId, t.id, t.version, source, db, store);
        assert.equal(saved.state, "ready");
        const [attachment] = await db.select().from(schema.inboxAttachments).where(eq(schema.inboxAttachments.id, saved.attachmentId));
        assert.ok(attachment.storageObjectKey);
        assert.equal(attachment.size, raw.length);
        assert.equal((await db.select().from(schema.inboxAttachmentBlobs).where(eq(schema.inboxAttachmentBlobs.attachmentId, saved.attachmentId))).length, 0);
        const scope = await scopeFor(saved);
        const download = await downloadAttachmentStream(scope, saved.attachmentId, db, store);
        assert.deepEqual(await hashBody(download.body), { size: raw.length, sha256 });
        assert.equal((await repo.transferArchivedImportFile(actor, saved.jobId, saved.id, saved.version, source, db, forbiddenStore)).attachmentId, saved.attachmentId);
        assert.equal(touched, 0);
        await assert.rejects(downloadAttachmentStream({ ...scope, orgId: otherActor.orgId }, saved.attachmentId, db, forbiddenStore), e => e.status === 404);
        await assert.rejects(downloadAttachmentStream({ ...scope, channelId: channels.bo.id }, saved.attachmentId, db, forbiddenStore), e => e.status === 404);
        assert.equal(touched, 0);
        const badRead = { ...store, get: async () => ({ size: raw.length, body: (async function* () { yield Buffer.alloc(raw.length, 118); })() }) };
        await assert.rejects(hashBody((await downloadAttachmentStream(scope, saved.attachmentId, db, badRead)).body), /검증/);
        await assert.rejects(downloadAttachmentStream(scope, saved.attachmentId, db, { ...store, get: async () => ({ size: 1, body: [] }) }), e => e.status === 502);
        const note = await complete("private-object-note", "note");
        const readyNote = await repo.transferArchivedImportFile(actor, note.jobId, note.id, note.version, source, db, store);
        await assert.rejects(downloadAttachmentStream({ ...await scopeFor(readyNote), publicOnly: true }, readyNote.attachmentId, db, forbiddenStore), e => e.status === 404);
        assert.equal(touched, 0);
        const corrupt = await complete("private-object-corrupt");
        await assert.rejects(repo.transferArchivedImportFile(actor, corrupt.jobId, corrupt.id, corrupt.version, source, db, badRead), e => e.status === 502);
        const failed = await getTask(corrupt.id);
        assert.equal(failed.state, "failed");
        assert.equal(failed.attachmentId, null);
        const resumed = await repo.transferArchivedImportFile(actor, failed.jobId, failed.id, failed.version, source, db, store);
        assert.equal(resumed.state, "ready");
        await assert.rejects(uploadAttachment({ orgId: actor.orgId, channelId: channels.dh.id, conversationId: null, ownerKey: "fictional", publicOnly: false }, { clientId: randomUUID(), kind: "note", fileName: "large.bin", bytes: raw }, db), e => e.status === 413);
        const quotaTask = await complete("private-object-quota");
        const previous = process.env.INBOX_ARCHIVE_QUOTA_MB;
        process.env.INBOX_ARCHIVE_QUOTA_MB = "20";
        try { await assert.rejects(repo.transferArchivedImportFile(actor, quotaTask.jobId, quotaTask.id, quotaTask.version, source, db, store), e => e.status === 413); }
        finally { if (previous === undefined) delete process.env.INBOX_ARCHIVE_QUOTA_MB; else process.env.INBOX_ARCHIVE_QUOTA_MB = previous; }
        assert.equal((await getTask(quotaTask.id)).attachmentId, null);
        const apiTask = await complete("private-object-sdk");
        const identity = { size: source.size, sha256 };
        await assert.rejects(clients.bo.planArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version, identity), e => e.status === 403);
        await assert.rejects(clients.read.planArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version, identity), e => e.status === 403);
        await assert.rejects(clients.dh.planArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version + 1, identity), e => e.status === 409);
        const plan = await clients.dh.planArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version, identity);
        assert.equal(plan.objectKey, `inbox-archive/${actor.orgId}/8/${apiTask.id}/${apiTask.version}/${sha256}.bin`);
        assert.equal((await getTask(apiTask.id)).state, "needs_source");
        await store.put(plan.objectKey, source);
        const apiSaved = await clients.dh.connectArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version, identity);
        assert.equal(apiSaved.state, "ready");
        assert.equal((await clients.dh.connectArchiveImportFile(apiTask.jobId, apiTask.id, apiTask.version, identity)).attachmentId, apiSaved.attachmentId);
        const apiDownloaded = await clients.dh.downloadAttachment(apiSaved.attachmentId);
        assert.equal(createHash("sha256").update(Buffer.from(apiDownloaded.bytes)).digest("hex"), sha256);
        const extraKey = await ctx.dispatch(`http://127.0.0.1:3120/api/v1/imports/${apiTask.jobId}/files`, { method: "POST", headers: { Authorization: `Bearer ${ctx.keys?.dh ?? "invalid"}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive_attach", id: apiTask.id, version: apiTask.version, ...identity, objectKey: "other-organization/object" }) });
        assert.equal(extraKey.status, 400);
        const { channelFixture } = require("./fixtures/customer-import-history-fictional.cjs");
        const verified = channelFixture({ conversations: 1, messages: 2, memberId: ctx.contacts.dh.externalId }).bundle;
        verified.users = verified.users.filter(u => u.id === "source-a");
        verified.userChats = verified.userChats.filter(c => c.id === "history-a-000");
        verified.messages = verified.messages.filter(m => m.chatId === "history-a-000").map(m => ({ ...m, files: m.files?.map(f => ({ ...f, size: source.size, sha256, url: undefined })) }));
        let publicJob = await clients.dh.previewImport({ workspaceId: 8, source: "channel", namespace: "private-object-verified-history", format: "json", content: JSON.stringify(verified), verifiedCustomerHistory: true });
        assert.deepEqual(publicJob.errors, []);
        publicJob = await clients.dh.changeImport(publicJob.id, { action: "start", version: publicJob.version, fingerprint: publicJob.fingerprint, acknowledge: true });
        while (publicJob.state === "running") publicJob = await clients.dh.stepImport(publicJob.id, publicJob.cursor);
        assert.equal(publicJob.state, "completed");
        const verifiedFiles = (await clients.dh.importFiles(publicJob.id)).rows;
        assert.equal(verifiedFiles.length, 3);
        const completedFiles = [];
        for (const f of verifiedFiles) completedFiles.push(await repo.transferArchivedImportFile(actor, f.jobId, f.id, f.version, source, db, store));
        const { SendbMessengerClient } = require("../sdk/messenger.ts");
        const token = (await clients.dh.customerIdentity(channels.dh.id, ctx.contacts.dh.id)).identityToken;
        const messenger = new SendbMessengerClient({ apiBase: "http://127.0.0.1:3120", channelKey: channels.dh.publicKey, getToken: () => token, fetchImpl: ctx.dispatch });
        const historyId = (await scopeFor(completedFiles[0])).conversationId;
        const visible = await messenger.conversation(historyId);
        assert.equal(visible.messages.flatMap(m => m.attachments).length, 2);
        assert.equal(JSON.stringify(visible).includes("objectKey"), false);
        assert.equal(JSON.stringify(visible).includes("PRIVATE_NOTE_ATTACHMENT"), false);
        for (const f of completedFiles) {
            const original = (await db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, f.messageId)))[0];
            if (original.kind === "note") await assert.rejects(messenger.download(f.attachmentId, historyId), e => e.status === 404);
            else assert.equal(createHash("sha256").update(Buffer.from((await messenger.download(f.attachmentId, historyId)).bytes)).digest("hex"), sha256);
        }
        const unrelated = await clients.dh.upsertContact({ workspaceId: 8, externalId: "archive-unrelated-verified", name: "다른 가상 회원" });
        const otherToken = (await clients.dh.customerIdentity(channels.dh.id, unrelated.id)).identityToken;
        const otherMessenger = new SendbMessengerClient({ apiBase: "http://127.0.0.1:3120", channelKey: channels.dh.publicKey, getToken: () => otherToken, fetchImpl: ctx.dispatch });
        await assert.rejects(otherMessenger.download(completedFiles[0].attachmentId, historyId), e => e.status === 404);
        for (const table of [schema.customerAiJobs, schema.customerWorkflowRuns, schema.platformWebhookDeliveries])
            assert.equal((await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0].n, 0);
        console.log("PASS PRIVATE ARCHIVE actual S3-compatible streaming PUT/GET · >20MB · size/hash · retry · source/storage corruption · cross-business/organization · verified-member public download and note denial · quota · normal upload cap · SDK plan/attach/download · arbitrary key rejection · no external sends");
    } finally { client.destroy(); await server.close(); }
    await ctx.pg.close();
}
runPostgresPlatformCheck(scenario).catch(e => { console.error(e); process.exitCode = 1; });
