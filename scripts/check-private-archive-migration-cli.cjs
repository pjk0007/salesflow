/* eslint-disable @typescript-eslint/no-require-imports -- Fictional native PostgreSQL, loopback S3 and operator CLI integration. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), http = require("node:http"), { createHash } = require("node:crypto"), { spawn } = require("node:child_process");
const { runPostgresPlatformCheck } = require("./customer-platform-test-postgres.cjs");
async function scenario(ctx) {
    const { clients, db } = ctx, schema = require("../src/lib/db/schema.ts"), { sql } = require("drizzle-orm");
    const { fileDescriptors } = require("../src/lib/customer-import-files/rules.ts"), { fingerprint } = require("../src/lib/customer-imports/rules.ts"), { createArchiveStore } = require("../src/lib/inbox-archive-storage/store.ts"), cli = require("./migrate-private-archive-files.cjs");
    const realTestRoot = fs.realpathSync(path.resolve(__dirname, "../.testenv")), directory = fs.mkdtempSync(path.join(realTestRoot, "private-archive-cli-")), archive = path.join(directory, "source"), bundleFile = path.join(directory, "bundle.json");
    fs.mkdirSync(archive); fs.mkdirSync(path.join(archive, "bytes"));
    const bytes = Buffer.alloc(20 * 1024 * 1024 + 1, 117), sha256 = createHash("sha256").update(bytes).digest("hex"), channelId = "fictional-private-cli", namespace = "fictional-private-cli";
    const bundle = require("./fixtures/customer-import-history-fictional.cjs").channelFixture({ conversations: 1, messages: 2, memberId: ctx.contacts.dh.externalId }).bundle;
    bundle.users = bundle.users.filter(u => u.id === "source-a"); bundle.userChats = bundle.userChats.filter(c => c.id === "history-a-000");
    bundle.messages = bundle.messages.filter(m => m.chatId === "history-a-000").map(m => ({ ...m, files: m.files.map(f => ({ ...f, size: bytes.length, sha256, url: undefined })) }));
    fs.writeFileSync(bundleFile, JSON.stringify(bundle)); fs.writeFileSync(path.join(archive, "bytes", sha256 + ".bin"), bytes);
    const manifest = { version: 1, channelId, scope: "all-customer-attachment-originals", sourceComplete: false, messageSourceComplete: true, files: [] };
    for (const message of bundle.messages) for (const d of fileDescriptors(message.files, 20 * 1024 * 1024)) manifest.files.push({ id: fingerprint([message.chatId, message.id, d.sourceKey]), chatId: message.chatId, messageId: message.id, sourceKey: d.sourceKey, descriptorHash: d.manifest, name: d.name, size: d.size, visibility: message.options?.includes("private") ? "private" : "public", state: "saved", archivedSize: bytes.length, sha256, path: `bytes/${sha256}.bin` });
    fs.writeFileSync(path.join(archive, "manifest.json"), JSON.stringify(manifest));
    let job = await clients.dh.previewImport({ workspaceId: 8, source: "channel", namespace, format: "json", content: JSON.stringify(bundle), verifiedCustomerHistory: false });
    assert.deepEqual(job.errors, []); job = await clients.dh.changeImport(job.id, { action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true });
    while (job.state === "running") job = await clients.dh.stepImport(job.id, job.cursor); assert.equal(job.state, "completed");
    const S3rver = require(path.join(realTestRoot, "archive-storage-qa/node_modules/s3rver")), { S3Client } = require("@aws-sdk/client-s3");
    const storageDir = path.join(directory, "storage"); fs.mkdirSync(storageDir);
    const server = new S3rver({ address: "127.0.0.1", port: 0, directory: storageDir, silent: true, configureBuckets: [{ name: "fictional-cli-private" }] });
    const { port } = await server.run(), storageEndpoint = `http://127.0.0.1:${port}`;
    const storageClient = new S3Client({ region: "auto", endpoint: storageEndpoint, forcePathStyle: true, credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
    const store = createArchiveStore(storageClient, "fictional-cli-private"); ctx.archiveTest.store = store;
    let apiHost;
    const count = async table => (await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0].n;
    const download = async id => {
        const response = await ctx.dispatch(`http://127.0.0.1:3120/api/v1/inbox/attachments/${id}`, { headers: { Authorization: `Bearer ${ctx.keys.dh}` } });
        assert.equal(response.status, 200); return response.body;
    };
    const args = out => ["--online", "--local-qa", "--bundle", bundleFile, "--archive-dir", archive, "--out", out, "--api-base", "http://127.0.0.1:3120", "--workspace-id", "8", "--namespace", namespace, "--channel-id", channelId, "--storage-endpoint", storageEndpoint, "--storage-bucket", "fictional-cli-private"];
    try {
        const options = cli.parseArgs(args(path.join(directory, "review"))), before = await count(schema.inboxAttachments);
        const review = await cli.run(options, { client: clients.dh, store, readTarget: download });
        assert.equal(review.total, 3); assert.equal(review.blocked, 0); assert.equal(review.remoteWrites, 0); assert.equal(await count(schema.inboxAttachments), before);
        const execute = { ...options, execute: true, approvedSha256: review.planSha256 }, deps = { client: clients.dh, store, readTarget: download };
        const result = await cli.run(execute, deps); assert.equal(result.status, "complete"); assert.equal(result.verified, 3); assert.equal(result.sourceCollectionComplete, false);
        assert.equal(await count(schema.inboxAttachments), before + 3); const rows = (await clients.dh.importFiles(job.id)).rows; const attached = rows.map(f => f.attachmentId);
        const resumed = await cli.run({ ...execute, resume: true }, deps); assert.equal(resumed.verified, 3); assert.equal(await count(schema.inboxAttachments), before + 3); assert.deepEqual((await clients.dh.importFiles(job.id)).rows.map(f => f.attachmentId), attached);
        await assert.rejects(cli.run({ ...execute, resume: true, identity: { ...execute.identity, origin: "https://another.example.test" } }, deps), e => e.code === "approval_or_source_changed");
        await assert.rejects(cli.run({ ...execute, resume: true, storage: { ...execute.storage, bucket: "another-private" } }, deps), e => e.code === "approval_or_source_changed");
        const byteFile = path.join(archive, "bytes", sha256 + ".bin"), fd = fs.openSync(byteFile, "r+");
        try { fs.writeSync(fd, Buffer.from([120]), 0, 1, 0); } finally { fs.closeSync(fd); }
        await assert.rejects(cli.run({ ...execute, resume: true }, deps), /SHA-256/);
        const restoredFd = fs.openSync(byteFile, "r+"); try { fs.writeSync(restoredFd, Buffer.from([117]), 0, 1, 0); } finally { fs.closeSync(restoredFd); }
        fs.writeFileSync(path.join(archive, ".archive.lock"), "fictional active archive");
        await assert.rejects(cli.run({ ...execute, resume: true }, deps), e => e.code === "archive_busy");
        fs.unlinkSync(path.join(archive, ".archive.lock"));
        assert.equal(await count(schema.inboxAttachments), before + 3);
        // Real child process, SDK and HTTP routing, with already-ready files: no object credentials are needed or loaded.
        apiHost = http.createServer(async (req, res) => {
            try {
                const chunks = []; for await (const c of req) chunks.push(c);
                const body = Buffer.concat(chunks), response = await ctx.dispatch(`http://127.0.0.1:3120${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
                res.writeHead(response.status, Object.fromEntries(response.headers));
                if (response.body) for await (const c of response.body) { if (!res.write(c)) await new Promise(r => res.once("drain", r)); }
                res.end();
            } catch { res.writeHead(500); res.end(); }
        });
        await new Promise(r => apiHost.listen(0, "127.0.0.1", r)); const apiOrigin = `http://127.0.0.1:${apiHost.address().port}`;
        const childArgs = args(path.join(directory, "child-review")); childArgs[childArgs.indexOf("--api-base") + 1] = apiOrigin;
        const child = async extra => new Promise((resolve, reject) => {
            const task = spawn(process.execPath, [path.resolve(__dirname, "migrate-private-archive-files.cjs"), ...childArgs, ...extra], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: "intentionally-invalid-cli-must-not-use-db", SENDB_FILE_TRANSFER_API_TOKEN: ctx.keys.dh, INBOX_ARCHIVE_S3_ACCESS_KEY_ID: "", INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY: "" } });
            let stdout = "", stderr = ""; task.stdout.on("data", c => { stdout += c; }); task.stderr.on("data", c => { stderr += c; });
            const timeout = setTimeout(() => { task.kill(); reject(Error("Owned CLI child timed out")); }, 60000);
            task.on("error", reject); task.on("exit", code => { clearTimeout(timeout); if (code !== 0) reject(Error(`Fictional CLI child failed: ${stdout} ${stderr}`)); else resolve(JSON.parse(stdout.trim())); });
        });
        const childPlan = await child([]); assert.equal(childPlan.ready, 3);
        const childResult = await child(["--execute", "--approve-sha256", childPlan.planSha256]); assert.equal(childResult.verified, 3); assert.equal(await count(schema.inboxAttachments), before + 3);
        const sourceContactToken = (await clients.dh.customerIdentity(ctx.channels.dh.id, ctx.contacts.dh.id)).identityToken;
        const chatId = (await clients.dh.importFile(job.id, rows[0].id)).message.conversationId;
        const response = await ctx.dispatch(`http://127.0.0.1:3120/api/messenger/${ctx.channels.dh.publicKey}/attachments/${rows[0].attachmentId}?conversationId=${chatId}`, { headers: { Authorization: `Bearer ${sourceContactToken}` } }); assert.equal(response.status, 404);
        for (const table of [schema.customerAiJobs, schema.customerWorkflowRuns, schema.platformWebhookDeliveries]) assert.equal(await count(table), 0);
        console.log("PASS ARCHIVE MIGRATION CLI native PG/S3: review has no writes; >20MB public/note files streamed; SDK relationship fingerprints; destination binding; resume has no duplicate attachment; real child CLI/HTTP protected downloads; history remains employee-only; no external sends");
    } finally { if (apiHost) await new Promise(r => apiHost.close(r)); storageClient.destroy(); await server.close(); }
    await ctx.pg.close();
}
runPostgresPlatformCheck(scenario).catch(error => { console.error(error); process.exitCode = 1; });
