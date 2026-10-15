/* eslint-disable @typescript-eslint/no-require-imports -- Offline-first CLI, no application bootstrap or dotenv. */
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "..");
class TransferCliError extends Error { constructor(code) { super("첨부 일괄 보충을 완료하지 못했습니다."); this.code = code; } }
function loadModules() {
    const previous = process.env.TSX_TSCONFIG_PATH;
    process.env.TSX_TSCONFIG_PATH = path.join(root, "tsconfig.json");
    try {
        const scopedRequire = require("tsx/cjs/api").require;
        const load = file => scopedRequire(path.join(root, file), __filename);
        return { ...load("src/lib/channel-source-export/transfer-local.ts"), ...load("src/lib/channel-source-export/transfer-plan.ts"), ...load("src/lib/channel-source-export/transfer-runner.ts"), ...load("sdk/server.ts") };
    } finally { if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH; else process.env.TSX_TSCONFIG_PATH = previous; }
}
function parseArgs(argv) {
    const values = {}, flags = new Set(["help", "online", "execute", "resume"]);
    const names = new Set(["export-dir", "out", "fixture", "api-base", "workspace-id", "namespace", "channel-id", "approve-sha256", "job-ids"]);
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i].startsWith("--") ? argv[i].slice(2) : "";
        if (!name || Object.hasOwn(values, name)) throw new TransferCliError("arguments");
        if (flags.has(name)) values[name] = true;
        else if (names.has(name) && argv[i + 1] && !argv[i + 1].startsWith("--")) values[name] = argv[++i];
        else throw new TransferCliError("arguments");
    }
    if (values.help) return { help: true };
    if (!values["export-dir"] || !values.out || !values.namespace || !values["channel-id"] || !/^[1-9]\d*$/.test(values["workspace-id"] ?? "") || !Number.isSafeInteger(Number(values["workspace-id"]))) throw new TransferCliError("arguments");
    if (!!values.fixture === !!values.online || (values.online !== !!values["api-base"] && (values.online || values["api-base"]))) throw new TransferCliError("arguments");
    if (values.execute ? !/^[a-f0-9]{64}$/.test(values["approve-sha256"] ?? "") : values.resume || values["approve-sha256"]) throw new TransferCliError("arguments");
    if (values.execute && values["job-ids"]) throw new TransferCliError("arguments");
    return { exportDir: values["export-dir"], out: values.out, fixture: values.fixture, apiBase: values["api-base"], online: !!values.online, execute: !!values.execute, resume: !!values.resume, approvedPlanSha256: values["approve-sha256"], jobIds: values["job-ids"]?.split(","), identity: { workspaceId: Number(values["workspace-id"]), source: "channel", namespace: values.namespace, channelId: values["channel-id"] } };
}
const HELP = `ChannelTalk archived file supplementation (default: offline review plan)
  node scripts/supplement-channel-source-files.cjs --export-dir <closed-export> --fixture <fictional-targets.json> --out <new-review-directory> --workspace-id 8 --namespace fictional-demo --channel-id qa-fictional-channel-export
Review plan.json, its blocked/unmatched rows and sha256. Explicit execution:
  same arguments --execute --approve-sha256 <reviewed-plan-sha256>
Resume an interrupted run with --resume; it rechecks current targets before sending.
Optional --job-ids id1,id2 restricts plan creation to those already imported jobs.
Offline fixture: {fictional:true,identity:{workspaceId,source:'channel',namespace,channelId},jobs:[{job,files,rowsComplete:true,filesComplete:true}]}.
Offline upload is a contract simulation, not proof of API/database storage. fixture-state.json records its resulting state and may be passed as the next --fixture.
Real target access is opt-in: --online --api-base <exact-origin> instead of --fixture and SENDB_FILE_TRANSFER_API_TOKEN in the process environment. No .env is loaded. --online alone reads; uploads additionally require --execute and the reviewed SHA.
The reviewed mode and exact target origin are included in the approval SHA. Switching fixture/online mode or target origin requires a new review plan. Every completed/ready file is downloaded through the protected SDK endpoint and checked against the archived SHA/size.
Only existing imports/files GET, protected attachment GET and multipart file POST are allowed. This tool never prepares file registries, imports CRM metadata, fetches provider URLs or deploys anything. A lock left after process termination requires inspection before manual removal; it is never bypassed automatically.
`;
/** A deliberately local contract fixture. All calls still go through the existing SendbClient. */
function createFixtureClient(modules, fixture, identity) {
    if (fixture?.fictional !== true || JSON.stringify(fixture.identity) !== JSON.stringify(identity) || !Array.isArray(fixture.jobs)) throw new TransferCliError("fixture");
    const state = structuredClone(fixture), requests = [];
    state.attachments ??= {};
    const respond = (data, status = 200) => new Response(JSON.stringify(status === 200 ? { success: true, data } : { success: false, error: "허구 fixture 요청 거절" }), { status, headers: { "Content-Type": "application/json" } });
    const client = new modules.SendbClient({ apiBase: "http://127.0.0.1:1", apiToken: "fictional-offline-no-network", fetchImpl: async (input, init = {}) => {
        const url = new URL(String(input)), method = init.method ?? "GET";
        requests.push({ method, path: url.pathname, query: url.search });
        if (url.origin !== "http://127.0.0.1:1") throw new TransferCliError("fixture");
        const attachmentId = /^\/api\/v1\/inbox\/attachments\/([^/]+)$/.exec(url.pathname)?.[1];
        if (method === "GET" && attachmentId) {
            const saved = state.attachments[decodeURIComponent(attachmentId)];
            if (!saved || typeof saved.base64 !== "string") return respond(null, 404);
            return new Response(Buffer.from(saved.base64, "base64"), { headers: { "Content-Type": "application/octet-stream" } });
        }
        if (method === "GET" && url.pathname === "/api/v1/imports") {
            if (Number(url.searchParams.get("workspaceId")) !== identity.workspaceId) return respond(null, 403);
            const before = url.searchParams.get("before"), start = before ? state.jobs.findIndex(row => row.job.id === before) + 1 : 0;
            if (before && start === 0) return respond(null, 404);
            const rows = state.jobs.slice(start, start + 50).map(row => row.job);
            return respond({ rows, hasMore: start + rows.length < state.jobs.length });
        }
        const match = /^\/api\/v1\/imports\/([^/]+)(\/files)?$/.exec(url.pathname), snapshot = match && state.jobs.find(row => row.job.id === decodeURIComponent(match[1]));
        if (!snapshot) return respond(null, 404);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (method === "GET" && !match[2]) return respond({ ...snapshot.job, total: snapshot.job.rows.length, cursor: snapshot.job.rows.length, rows: snapshot.job.rows.slice(offset, offset + 100), results: snapshot.job.results.filter(row => row.position >= offset && row.position < offset + 100), hasMore: offset + 100 < snapshot.job.rows.length });
        if (method === "GET" && match[2]) return respond({ rows: snapshot.files.slice(offset, offset + 100), total: snapshot.files.length, offset, hasMore: offset + 100 < snapshot.files.length, counts: [] });
        if (method === "POST" && match[2] && init.body instanceof FormData) {
            const file = snapshot.files.find(row => row.id === init.body.get("id")), blob = init.body.get("file");
            if (!file || file.version !== Number(init.body.get("version")) || !file.active || file.state === "ready" || !(blob instanceof Blob) || blob.name !== file.fileName) return respond(null, 409);
            const bytes = Buffer.from(await blob.arrayBuffer()), digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
            if ((file.expectedSize !== null && file.expectedSize !== bytes.length) || (file.expectedSha256 !== null && file.expectedSha256 !== digest)) return respond(null, 400);
            Object.assign(file, { state: "ready", attachmentId: randomUUID(), version: file.version + 2 });
            state.attachments[file.attachmentId] = { base64: bytes.toString("base64") };
            return respond(file);
        }
        return respond(null, 405);
    } });
    return { client, state, requests };
}
function canonicalOrigin(value) {
    let url; try { url = new URL(value); } catch { throw new TransferCliError("api_base"); }
    if (url.href !== url.origin + "/" || url.username || url.password || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new TransferCliError("api_base");
    return url.origin;
}
function targetBinding(options, dependencies) {
    if (dependencies.client) return { mode: "test-client", origin: canonicalOrigin(dependencies.targetOrigin) };
    if (options.fixture && !options.online) return { mode: "offline-fixture", origin: "offline-contract" };
    if (options.online && !options.fixture) return { mode: "online-api", origin: canonicalOrigin(options.apiBase) };
    throw new TransferCliError("arguments");
}
function onlineClient(modules, options, signal) {
    const token = process.env.SENDB_FILE_TRANSFER_API_TOKEN;
    if (!options.online || !token) throw new TransferCliError("credentials");
    const origin = canonicalOrigin(options.apiBase);
    return new modules.SendbClient({ apiBase: origin, apiToken: token, fetchImpl: (input, init = {}) => {
        const url = new URL(String(input)), method = init.method ?? "GET";
        if (url.origin !== origin || !(method === "GET" && /^\/api\/v1\/imports(?:\/[^/]+(?:\/files)?)?$/.test(url.pathname) || options.execute && method === "GET" && /^\/api\/v1\/inbox\/attachments\/[^/]+$/.test(url.pathname) || options.execute && method === "POST" && /^\/api\/v1\/imports\/[^/]+\/files$/.test(url.pathname) && init.body instanceof FormData)) throw new TransferCliError("request_scope");
        return fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]) });
    } });
}
async function runSupplement(options, dependencies = {}) {
    const modules = loadModules(), signal = dependencies.signal;
    const destination = targetBinding(options, dependencies);
    const source = await modules.loadChannelTransferSource(options.exportDir, options.identity);
    const output = path.resolve(options.out), relative = path.relative(source.directory, output);
    if (!relative || !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)) throw new TransferCliError("output_scope");
    const journal = await modules.openChannelTransferJournal(output, options.identity, options.execute);
    let fixtureClient;
    try {
        let plan;
        if (options.execute) {
            plan = await journal.read("plan.json");
            if (!plan || plan.sha256 !== options.approvedPlanSha256 || modules.channelTransferPlanSha256(plan) !== options.approvedPlanSha256 || JSON.stringify(plan.identity) !== JSON.stringify(options.identity)) throw new TransferCliError("approval");
            if (JSON.stringify(plan.targetBinding) !== JSON.stringify(destination)) throw new TransferCliError("target_binding_changed");
            if (JSON.stringify(plan.sourceSnapshot) !== JSON.stringify(source.sourceFiles)) throw new TransferCliError("source_changed");
        }
        let client = dependencies.client;
        if (!client && options.fixture) {
            const full = path.resolve(options.fixture), bytes = await modules.readChannelTransferFile(path.dirname(full), path.basename(full));
            let fixture; try { fixture = JSON.parse(bytes.toString("utf8")); } catch { throw new TransferCliError("fixture"); }
            fixtureClient = createFixtureClient(modules, fixture, options.identity); client = fixtureClient.client;
        }
        if (!client) client = onlineClient(modules, options, signal);
        if (!options.execute) {
            const jobs = await modules.collectChannelTransferJobs(client, options.identity, { jobIds: options.jobIds, signal });
            plan = modules.createChannelTransferPlan({ identity: options.identity, bundle: source.bundle, manifest: source.manifest, jobs, localIssues: source.localIssues, sourceSnapshot: source.sourceFiles, targetBinding: destination });
            await journal.write("plan.json", plan);
            return { mode: "review", planSha256: plan.sha256, plan: path.join(journal.directory, "plan.json"), counts: { upload: plan.items.filter(row => row.action === "upload").length, alreadyReady: plan.items.filter(row => row.action === "already_ready").length, blocked: plan.items.filter(row => row.action === "blocked").length, unmatchedTargets: plan.unmatchedTargets.length }, issues: plan.issues, migrationApplied: false, uploads: 0, exitCode: 0 };
        }
        const prior = await journal.read("checkpoint.json");
        if (prior && !options.resume || options.resume && !prior) throw new TransferCliError("resume");
        const result = await modules.runChannelFileTransfer(plan, {
            approvedPlanSha256: options.approvedPlanSha256, resume: prior, signal,
            refreshJob: jobId => modules.readChannelTransferJob(client, options.identity, jobId, signal),
            readBytes: receipt => modules.readChannelTransferBytes(source.directory, receipt),
            readTargetBytes: async file => { signal?.throwIfAborted(); return Buffer.from((await client.downloadAttachment(file.attachmentId)).bytes); },
            upload: async (item, bytes) => {
                signal?.throwIfAborted();
                const file = await client.uploadImportFile(item.target.jobId, item.target.fileId, item.target.version, new Blob([bytes]), item.source.name);
                return modules.channelTransferTargetFile(file, item.target.jobId, options.identity);
            },
            checkpoint: async checkpoint => {
                await journal.write("checkpoint.json", checkpoint);
                if (fixtureClient) await journal.write("fixture-state.json", fixtureClient.state);
            },
        });
        const report = { ...result, mode: fixtureClient ? "offline-contract-simulation" : "existing-api-upload", targetBinding: destination, planSha256: plan.sha256, migrationApplied: false, sourceFiles: source.sourceFiles, ...(fixtureClient ? { fixtureRequests: fixtureClient.requests } : {}) };
        await journal.write("result.json", report);
        return { status: result.status, counts: result.counts, issue: result.issue, mode: report.mode, result: path.join(journal.directory, "result.json"), migrationApplied: false, exitCode: result.status === "complete" ? 0 : 2 };
    } finally { await journal.close(); }
}
async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(HELP); return 0; }
    const controller = new AbortController(), abort = () => controller.abort();
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try { const result = await runSupplement(options, { signal: controller.signal }); process.stdout.write(JSON.stringify(result) + "\n"); return result.exitCode; }
    finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
module.exports = { parseArgs, createFixtureClient, runSupplement, main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
    // Only bounded machine codes are logged, never API error bodies, tokens or file contents.
    const code = /^[a-z_]{1,60}$/.test(error?.code ?? "") ? error.code : "transfer_failed";
    process.stderr.write(JSON.stringify({ status: "failed", code, migrationApplied: false }) + "\n"); process.exitCode = 1;
});
