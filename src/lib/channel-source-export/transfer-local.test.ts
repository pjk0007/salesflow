import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { SendbClient } from "../../../sdk/server";
import { channelOutputIdentity, openChannelOutput } from "./output";
import { splitChannelBundle } from "./chunks";
import { backupChannelFiles } from "./files";
import { fileDescriptors } from "@/lib/customer-import-files/rules";
import { fingerprint } from "@/lib/customer-imports/rules";
import { createChannelTransferPlan, type ChannelTransferIdentity, type ChannelTransferJobSnapshot } from "./transfer-plan";
import { ChannelTransferLocalError, collectChannelTransferJobs, loadChannelTransferSource, openChannelTransferJournal, readChannelTransferBytes, readChannelTransferJob } from "./transfer-local";

const identity: ChannelTransferIdentity = { workspaceId: 8, source: "channel", namespace: "fictional-transfer", channelId: "fictional-channel" };
const outputIdentity = channelOutputIdentity(identity);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const bytes = Buffer.from("%PDF-1.7\nfictional archived attachment\n%%EOF");
const file = { id: "file-one", key: "key-one", name: "가상 원본.pdf", size: bytes.length, sha256: hash(bytes) };
const bundle = { users: [{ id: "u", profile: { name: "허구" } }], managers: [], bots: [], userChats: [{ id: "c", userId: "u", state: "closed" }], messages: [{ id: "m", chatId: "c", personType: "user", personId: "u", plainText: "허구", createdAt: 1704067200000, files: [file] }], hasNext: false };
const code = (expected: string) => (error: unknown) => error instanceof ChannelTransferLocalError && error.code === expected;
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
async function temporary(run: (directory: string) => Promise<void>) {
    const directory = await fs.mkdtemp(path.join(tmpdir(), "sendb-transfer-local-"));
    try { await run(directory); } finally {
        assert.equal(path.dirname(directory).toLowerCase(), (await fs.realpath(tmpdir())).toLowerCase());
        assert.ok(path.basename(directory).startsWith("sendb-transfer-local-"));
        await fs.rm(directory, { recursive: true, force: true });
    }
}
async function archive(directory: string) {
    const output = await openChannelOutput(path.join(directory, "export"), outputIdentity);
    await output.saveSourcePage({ path: "/open/channel", query: {}, apiVersion: outputIdentity.apiVersion, status: 200, body: { channel: { id: identity.channelId } } });
    const checkpoint = { schemaVersion: 1, apiVersion: outputIdentity.apiVersion, channelId: identity.channelId, pageSize: outputIdentity.pageSize, requestCount: 1, status: "complete", bundle, ledger: { channel: { path: "/open/channel", query: {}, status: "complete", pages: 1, seenCursors: [null] } } };
    const backup = await backupChannelFiles(bundle, { channelId: identity.channelId, request: async () => ({ status: 200, body: { result: "https://files.example.test/fictional" } }), download: async () => bytes, save: output.saveBytes, checkpoint: output.writeFilesCheckpoint });
    assert.equal(backup.status, "complete");
    await output.publish({ status: "complete", bundle, checkpoint, counts: {}, limitations: [] }, splitChannelBundle(bundle, identity), backup);
    await output.close();
    return output.directory;
}
function targetJob(id = "job-one", count = 1): ChannelTransferJobSnapshot {
    const descriptor = fileDescriptors([file])[0];
    return {
        job: { id, workspaceId: 8, source: "channel", namespace: identity.namespace, state: "completed", version: 2, fingerprint: "a".repeat(64),
            rows: Array.from({ length: count }, (_, index) => ({ index, kind: "messages", sourceId: index === 0 ? "c/m" : `c/m-${index}`, data: { conversationId: "c", messageKind: "customer", files: [file] }, errors: [] })),
            results: Array.from({ length: count }, (_, position) => ({ position, targetId: String(position + 1) })), },
        files: Array.from({ length: count }, (_, index) => ({ id: `${id}-file-${index}`, jobId: id, workspaceId: 8, messageId: index + 1, sourceKey: descriptor.sourceKey, manifest: descriptor.manifest, fileName: descriptor.name, state: "needs_source", active: true, metadataValid: true, version: 1, expectedSize: bytes.length, expectedSha256: hash(bytes), attachmentId: null, interrupted: false, locator: { ...descriptor.locator, conversationId: "c", messageSourceId: index === 0 ? "c/m" : `c/m-${index}` } })), rowsComplete: true, filesComplete: true,
    };
}
const requireCli = createRequire(import.meta.url);
const cli = requireCli("../../../scripts/supplement-channel-source-files.cjs") as {
    parseArgs: (argv: string[]) => Record<string, unknown>;
    createFixtureClient: (modules: { SendbClient: typeof SendbClient }, fixture: unknown, scope: ChannelTransferIdentity) => { client: SendbClient; state: unknown; requests: { method: string; path: string; query: string }[] };
    runSupplement: (options: Record<string, unknown>, dependencies?: { client: SendbClient; targetOrigin: string }) => Promise<Record<string, unknown>>;
};
const fixtureClient = (jobs: ChannelTransferJobSnapshot[]) => cli.createFixtureClient({ SendbClient }, { fictional: true, identity, jobs }, identity);

test("실제 exporter 저장 형식의 owner/checkpoint/raw/pages/chunks/files SHA를 읽고 원본 바이트 확인", async () => temporary(async directory => {
    const root = await archive(directory), source = await loadChannelTransferSource(root, identity);
    assert.deepEqual(source.localIssues, []); assert.deepEqual(source.bundle, bundle);
    assert.ok(source.sourceFiles.some(item => item.path.startsWith("pages/")));
    assert.ok(source.sourceFiles.some(item => item.path.startsWith("chunks/")));
    assert.deepEqual(await readChannelTransferBytes(root, source.manifest.files[0].receipt!), bytes);
    const plan = createChannelTransferPlan({ ...source, identity, jobs: [targetJob()], sourceSnapshot: source.sourceFiles });
    assert.equal(plan.items[0].action, "upload");
}));

test("다른 workspace/namespace/channel, 활성 exporter lock 및 손상 metadata SHA를 거절", async () => temporary(async directory => {
    const root = await archive(directory);
    for (const changed of [{ workspaceId: 9 }, { namespace: "other" }, { channelId: "other" }]) await assert.rejects(loadChannelTransferSource(root, { ...identity, ...changed }), code("identity"));
    await fs.writeFile(path.join(root, ".export.lock"), "{}");
    await assert.rejects(loadChannelTransferSource(root, identity), code("export_busy"));
    await fs.unlink(path.join(root, ".export.lock"));
    for (const name of ["checkpoint.json", "files.json", "files-checkpoint.json", "pages-index.json"]) {
        const full = path.join(root, name), original = await fs.readFile(full), value = JSON.parse(original.toString());
        value.sha256 = "0".repeat(64); await fs.writeFile(full, JSON.stringify(value));
        await assert.rejects(loadChannelTransferSource(root, identity), code("integrity")); await fs.writeFile(full, original);
    }
    const manifest = await readJson(path.join(root, "manifest.json"));
    await fs.appendFile(path.join(root, manifest.raw.path), " ");
    await assert.rejects(loadChannelTransferSource(root, identity), code("integrity"));
}));

test("개별 bytes 누락·SHA 손상은 blocked 계획에 남고 실행 직전 읽기도 거절", async () => temporary(async directory => {
    const root = await archive(directory), initial = await loadChannelTransferSource(root, identity), receipt = initial.manifest.files[0].receipt!, full = path.join(root, receipt.path);
    await fs.writeFile(full, Buffer.alloc(bytes.length));
    const corrupted = await loadChannelTransferSource(root, identity);
    assert.deepEqual(corrupted.localIssues, [{ id: initial.manifest.files[0].id, code: "local_bytes_corrupt" }]);
    const plan = createChannelTransferPlan({ ...corrupted, identity, jobs: [targetJob()] });
    assert.equal(plan.items[0].action, "blocked"); assert.ok(plan.items[0].issues.includes("local_bytes_corrupt"));
    await assert.rejects(readChannelTransferBytes(root, receipt), code("integrity"));
    await fs.unlink(full);
    assert.equal((await loadChannelTransferSource(root, identity)).localIssues[0].code, "local_bytes_missing");
}));

test("해시가 맞아도 ../·절대 경로·Windows ADS·junction을 통과시키지 않음", async () => temporary(async directory => {
    const root = await archive(directory), source = await loadChannelTransferSource(root, identity), receipt = source.manifest.files[0].receipt!;
    for (const unsafe of ["../outside.bin", "C:/outside.bin", "bytes/name:stream", `bytes\\${receipt.sha256}.bin`]) await assert.rejects(readChannelTransferBytes(root, { ...receipt, path: unsafe }), code("path"));
    const real = path.join(root, "bytes-real"); await fs.rename(path.join(root, "bytes"), real);
    await fs.symlink(real, path.join(root, "bytes"), process.platform === "win32" ? "junction" : "dir");
    try { await assert.rejects(loadChannelTransferSource(root, identity), code("path")); } finally { await fs.unlink(path.join(root, "bytes")); }
    await fs.symlink(root, path.join(directory, "linked-export"), process.platform === "win32" ? "junction" : "dir");
    try { await assert.rejects(loadChannelTransferSource(path.join(directory, "linked-export"), identity), code("path")); } finally { await fs.unlink(path.join(directory, "linked-export")); }
}));

test("51개 job 목록과 여러 chunk의 101/205개 원본행·파일 페이지를 SDK로 빠짐없이 순회", async () => {
    const jobs = Array.from({ length: 51 }, (_, index) => targetJob(`job-${index}`, index === 0 ? 205 : index === 50 ? 101 : 0));
    const fixture = fixtureClient(jobs), snapshots = await collectChannelTransferJobs(fixture.client, identity);
    assert.equal(snapshots.length, 51);
    assert.equal(snapshots[0].job.rows.length, 205); assert.equal(snapshots[0].files.length, 205);
    assert.equal(snapshots[50].job.results.length, 101); assert.equal(snapshots[50].files.length, 101);
    assert.ok(fixture.requests.some(request => request.path === "/api/v1/imports" && request.query.includes("before=")));
    assert.ok(fixture.requests.some(request => request.path === "/api/v1/imports/job-0/files" && request.query === "?offset=200"));
    assert.ok(fixture.requests.every(request => request.method === "GET"));
});

test("페이지 반복·총계 변경·중간 job version 변경·잘못된 scope를 조용히 합치지 않음", async () => {
    for (const mode of ["repeat", "total", "version", "scope"] as const) {
        const fixture = fixtureClient([targetJob("job-one", 101)]), base = fixture.client;
        const client = {
            imports: base.imports.bind(base),
            import: async (id: string, offset = 0) => { const value = await base.import(id, offset); if (mode === "version" && offset > 0) value.version++; if (mode === "scope") value.workspaceId++; return value; },
            importFiles: async (id: string, offset = 0) => { const value = await base.importFiles(id, offset); if (offset > 0 && mode === "repeat") value.rows[0].id = "job-one-file-0"; if (offset > 0 && mode === "total") value.total++; return value; },
        };
        await assert.rejects(readChannelTransferJob(client, identity, "job-one"), code(mode === "repeat" ? "page_contract" : mode === "scope" ? "identity" : "target_changed"));
    }
});

test("독립 journal 소유·배타 lock·불변 계획을 지키고 exporter 폴더를 사용하지 않음", async () => temporary(async directory => {
    const target = path.join(directory, "review"), journal = await openChannelTransferJournal(target, identity);
    await journal.write("plan.json", { fictional: true });
    await assert.rejects(journal.write("plan.json", {}), code("output_exists"));
    await assert.rejects(openChannelTransferJournal(target, identity, true), code("output_locked"));
    await journal.close();
    await assert.rejects(openChannelTransferJournal(target, { ...identity, workspaceId: 9 }, true), code("identity"));
    const resumed = await openChannelTransferJournal(target, identity, true); assert.deepEqual(await resumed.read("plan.json"), { fictional: true }); await resumed.close();
}));

test("CLI 기본 dry-run은 업로드 0, 검토 SHA 명시 후 원본 이름 SDK 업로드·결과·재개가 동작", async () => temporary(async directory => {
    const root = await archive(directory), out = path.join(directory, "review"), fixture = path.join(directory, "targets.json");
    await fs.writeFile(fixture, JSON.stringify({ fictional: true, identity, jobs: [targetJob()] }));
    const options = { exportDir: root, out, fixture, identity };
    const review = await cli.runSupplement(options);
    assert.equal(review.mode, "review"); assert.equal(review.uploads, 0);
    const plan = await readJson(path.join(out, "plan.json")); assert.equal(plan.items[0].source.name, file.name);
    await assert.rejects(cli.runSupplement({ ...options, execute: true, approvedPlanSha256: "0".repeat(64) }), /완료하지/);
    const result = await cli.runSupplement({ ...options, execute: true, approvedPlanSha256: plan.sha256 });
    assert.equal(result.status, "complete"); assert.equal(result.mode, "offline-contract-simulation");
    const report = await readJson(path.join(out, "result.json")); assert.equal(report.counts.uploadedThisRun, 1);
    assert.equal(report.fixtureRequests.filter((request: { method: string }) => request.method === "POST").length, 1);
    assert.equal(report.fixtureRequests.filter((request: { path: string }) => request.path.startsWith("/api/v1/inbox/attachments/")).length, 1);
    const resumed = await cli.runSupplement({ ...options, fixture: path.join(out, "fixture-state.json"), execute: true, resume: true, approvedPlanSha256: plan.sha256 });
    assert.equal(resumed.status, "complete"); assert.equal((resumed.counts as { uploadedThisRun: number }).uploadedThisRun, 0);
    const owner = await readJson(path.join(root, "owner.json")); owner.createdAt = "changed"; await fs.writeFile(path.join(root, "owner.json"), JSON.stringify(owner));
    await assert.rejects(cli.runSupplement({ ...options, execute: true, resume: true, approvedPlanSha256: plan.sha256 }), /완료하지/);
}));

test("승인 계획은 offline/online 및 목적지 origin을 묶어 다른 서버 실행을 요청 전에 거절", async () => temporary(async directory => {
    const root = await archive(directory), fixture = path.join(directory, "targets.json");
    await fs.writeFile(fixture, JSON.stringify({ fictional: true, identity, jobs: [targetJob()] }));
    const offline = { exportDir: root, out: path.join(directory, "offline"), fixture, identity };
    const review = await cli.runSupplement(offline);
    await assert.rejects(cli.runSupplement({ ...offline, fixture: undefined, online: true, apiBase: "https://different.example.test", execute: true, approvedPlanSha256: review.planSha256 }), (error: unknown) => (error as { code: string }).code === "target_binding_changed");
    const injected = fixtureClient([targetJob()]), options = { exportDir: root, out: path.join(directory, "injected"), identity };
    const approved = await cli.runSupplement(options, { client: injected.client, targetOrigin: "http://127.0.0.1:3148" });
    const count = injected.requests.length;
    await assert.rejects(cli.runSupplement({ ...options, execute: true, approvedPlanSha256: approved.planSha256 }, { client: injected.client, targetOrigin: "http://127.0.0.1:3149" }), (error: unknown) => (error as { code: string }).code === "target_binding_changed");
    assert.equal(injected.requests.length, count);
    const plan = await readJson(path.join(options.out, "plan.json"));
    assert.deepEqual(plan.targetBinding, { mode: "test-client", origin: "http://127.0.0.1:3148" });
}));

test("이미 ready인 대상도 보호 다운로드 SHA가 다르면 완료로 집계하거나 덮어쓰지 않음", async () => temporary(async directory => {
    const root = await archive(directory), fixture = path.join(directory, "ready.json"), job = targetJob();
    Object.assign(job.files[0], { state: "ready", attachmentId: "already-ready" });
    await fs.writeFile(fixture, JSON.stringify({ fictional: true, identity, jobs: [job], attachments: { "already-ready": { base64: Buffer.from("wrong bytes").toString("base64") } } }));
    const options = { exportDir: root, out: path.join(directory, "review"), fixture, identity }, review = await cli.runSupplement(options);
    const result = await cli.runSupplement({ ...options, execute: true, approvedPlanSha256: review.planSha256 });
    assert.equal(result.status, "failed"); assert.equal(result.issue, "target_bytes_mismatch");
    const report = await readJson(path.join(options.out, "result.json"));
    assert.equal(report.counts.alreadyReady, 0);
    assert.equal(report.fixtureRequests.filter((request: { method: string }) => request.method === "POST").length, 0);
}));

test("CLI 네트워크/실행은 명시적 인자이며 기본경로로 credentials나 .env를 읽지 않음", () => {
    const base = ["--export-dir", "export", "--out", "review", "--workspace-id", "8", "--namespace", "fictional", "--channel-id", "fictional"];
    assert.throws(() => cli.parseArgs(base));
    assert.throws(() => cli.parseArgs([...base, "--api-base", "https://example.test"]));
    assert.throws(() => cli.parseArgs([...base, "--fixture", "fixture.json", "--execute"]));
    assert.throws(() => cli.parseArgs([...base, "--fixture", "fixture.json", "--online", "--api-base", "https://example.test"]));
    assert.equal(cli.parseArgs([...base, "--fixture", "fixture.json"]).online, false);
    assert.equal(cli.parseArgs([...base, "--online", "--api-base", "https://example.test"]).execute, false);
    assert.equal(fingerprint(identity).length, 64);
});
