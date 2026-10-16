/* eslint-disable @typescript-eslint/no-require-imports -- Explicit operator CLI; no dotenv, DB connection, source provider request, or application bootstrap. */
const path = require("node:path"), root = path.resolve(__dirname, "..");
class CliError extends Error { constructor(code) { super("비공개 보관 첨부 이전을 완료하지 못했습니다."); this.code = code; } }
function modules() {
    const previous = process.env.TSX_TSCONFIG_PATH;
    process.env.TSX_TSCONFIG_PATH = path.join(root, "tsconfig.json");
    try {
        const scoped = require("tsx/cjs/api").require, load = p => scoped(path.join(root, p), __filename);
        return { ...load("src/lib/inbox-archive-storage/migration-source.ts"), ...load("src/lib/inbox-archive-storage/migration.ts"), ...load("src/lib/inbox-archive-storage/store.ts"), ...load("src/lib/channel-source-export/transfer-local.ts"), ...load("sdk/server.ts"), fingerprint: load("src/lib/customer-imports/rules.ts").fingerprint };
    } finally { if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH; else process.env.TSX_TSCONFIG_PATH = previous; }
}
function origin(value, loopbackAllowed) {
    let url; try { url = new URL(value); } catch { throw new CliError("origin"); }
    if (![url.origin, url.origin + "/"].includes(value) || url.username || url.password || (url.protocol !== "https:" && !(loopbackAllowed && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new CliError("origin");
    return url.origin;
}
function parseArgs(argv) {
    const values = {}, flags = new Set(["help", "online", "execute", "resume", "local-qa"]), names = new Set(["bundle", "archive-dir", "out", "api-base", "workspace-id", "namespace", "channel-id", "storage-endpoint", "storage-bucket", "storage-region", "approve-sha256"]);
    for (let n = 0; n < argv.length; n++) {
        const name = argv[n].startsWith("--") ? argv[n].slice(2) : "";
        if (!name || Object.hasOwn(values, name)) throw new CliError("arguments");
        if (flags.has(name)) values[name] = true;
        else if (names.has(name) && argv[n + 1] && !argv[n + 1].startsWith("--")) values[name] = argv[++n];
        else throw new CliError("arguments");
    }
    if (values.help) return { help: true };
    if (!values.bundle || !values["archive-dir"] || !values.out || !values.online || !/^[1-9]\d*$/.test(values["workspace-id"] ?? "") || !Number.isSafeInteger(Number(values["workspace-id"])) || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(values.namespace ?? "") || values.namespace.trim() !== values.namespace || typeof values["channel-id"] !== "string" || !values["channel-id"] || values["channel-id"].length > 200) throw new CliError("arguments");
    if (values.execute ? !/^[a-f0-9]{64}$/.test(values["approve-sha256"] ?? "") : values.resume || values["approve-sha256"]) throw new CliError("arguments");
    const api = origin(values["api-base"], true), endpoint = origin(values["storage-endpoint"] ?? process.env.INBOX_ARCHIVE_S3_ENDPOINT, !!values["local-qa"]), bucket = values["storage-bucket"] ?? process.env.INBOX_ARCHIVE_S3_BUCKET;
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? "")) throw new CliError("storage_bucket");
    if (values["local-qa"] && ![api, endpoint].every(v => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(v).hostname))) throw new CliError("local_qa_scope");
    return { bundle: values.bundle, archiveDir: values["archive-dir"], out: values.out, execute: !!values.execute, resume: !!values.resume, approvedSha256: values["approve-sha256"], localQa: !!values["local-qa"],
        identity: { workspaceId: Number(values["workspace-id"]), namespace: values.namespace, channelId: values["channel-id"], origin: api }, storage: { endpoint, bucket, region: values["storage-region"] ?? process.env.INBOX_ARCHIVE_S3_REGION ?? "auto" } };
}
const HELP = `Private archive file migration through Sendb APIs (read-only review by default)
  node scripts/migrate-private-archive-files.cjs --online --bundle <canonical-channel-bundle.json> --archive-dir <closed-byte-archive> --out <new-plan-directory> --api-base <exact-origin> --workspace-id 8 --namespace <source-account> --channel-id <channel> --storage-endpoint <https-s3-origin> --storage-bucket <private-bucket>
Requires SENDB_FILE_TRANSFER_API_TOKEN in the process environment. It never loads .env or uses a DB URL.
Review plan.json, exact API/storage destination, source limitations, relationships, blocked rows and SHA.
  same arguments --execute --approve-sha256 <reviewed-plan-sha256>
Execution additionally requires INBOX_ARCHIVE_S3_ACCESS_KEY_ID and INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY.
Resume with --resume and the same plan SHA. Ready files are verified by protected streaming downloads.
No CRM import, file registry preparation, provider fetch, deployment, file deletion, identity matching or customer-history exposure.
The canonical bundle and all-customer-attachment-originals manifest must agree. Source collection gaps remain visible; completion covers only reviewed bundle attachments.
--local-qa permits HTTP storage only when both API and storage hosts are loopback.
`;
async function run(options, deps = {}) {
    const m = modules(), signal = deps.signal, token = deps.token ?? process.env.SENDB_FILE_TRANSFER_API_TOKEN;
    if (!deps.client && !token) throw new CliError("api_credentials");
    const request = async (input, init = {}) => {
        const url = new URL(String(input)), method = init.method ?? "GET";
        const filePath = /^\/api\/v1\/imports\/[^/]+\/files$/.test(url.pathname), allowedGet = /^\/api\/v1\/imports(?:\/[^/]+\/files)?$/.test(url.pathname);
        const action = typeof init.body === "string" ? JSON.parse(init.body).action : undefined;
        if (url.origin !== options.identity.origin || !(method === "GET" && allowedGet || options.execute && method === "POST" && filePath && ["archive_plan", "archive_attach"].includes(action))) throw new CliError("api_request_scope");
        return (deps.fetch ?? fetch)(url, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(10 * 60000), ...(signal ? [signal] : [])]) });
    };
    const client = deps.client ?? new m.SendbClient({ apiBase: options.identity.origin, apiToken: token, fetchImpl: request });
    const source = await m.loadArchiveMigrationSource(options.bundle, options.archiveDir, options.identity, signal);
    const out = path.resolve(options.out), relative = path.relative(source.directory, out);
    if (!relative || relative === "." || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new CliError("output_scope");
    const journal = await m.openChannelTransferJournal(out, { workspaceId: options.identity.workspaceId, namespace: options.identity.namespace, channelId: options.identity.channelId, source: "channel" }, options.execute);
    let storage, storageClient;
    const getStore = () => {
        if (storage) return storage;
        if (deps.store) return storage = deps.store;
        const accessKeyId = process.env.INBOX_ARCHIVE_S3_ACCESS_KEY_ID, secretAccessKey = process.env.INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY;
        if (!accessKeyId || !secretAccessKey) throw new CliError("storage_credentials");
        storageClient = new (require("@aws-sdk/client-s3").S3Client)({ endpoint: options.storage.endpoint, region: options.storage.region, forcePathStyle: options.localQa, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
        return storage = m.createArchiveStore(storageClient, options.storage.bucket);
    };
    try {
        if (!options.execute) {
            const targets = await m.collectArchiveTargets(client, options.identity, signal), plan = m.createArchiveMigrationPlan(options.identity, options.storage, source, targets);
            await journal.write("plan.json", plan);
            return { mode: "review", planSha256: plan.sha256, scope: plan.coverage.scope, total: plan.items.length, ready: plan.items.filter(i => i.target.file.state === "ready").length, blocked: plan.items.filter(i => i.issues.length).length, unmatchedTargets: plan.unmatchedTargets.length, coverage: plan.coverage, remoteWrites: 0 };
        }
        const plan = await journal.read("plan.json");
        if (!plan || !Array.isArray(plan.items) || m.archiveMigrationPlanSha(plan) !== options.approvedSha256 || plan.sha256 !== options.approvedSha256 || m.fingerprint(plan.identity) !== m.fingerprint(options.identity) || m.fingerprint(plan.storage) !== m.fingerprint(options.storage) || m.fingerprint(plan.sourceSnapshot) !== m.fingerprint(source.snapshot) || m.fingerprint(plan.items.map(i => i.source)) !== m.fingerprint(source.files)) throw new CliError("approval_or_source_changed");
        const checkpoint = await journal.read("checkpoint.json");
        if (!!checkpoint !== options.resume) throw new CliError("resume");
        const readTarget = deps.readTarget ?? (async id => {
            signal?.throwIfAborted();
            const response = await (deps.fetch ?? fetch)(new URL(`/api/v1/inbox/attachments/${encodeURIComponent(id)}`, options.identity.origin), { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(10 * 60000), ...(signal ? [signal] : [])]) });
            if (!response.ok || !response.body) throw Object.assign(new CliError("protected_download"), { status: response.status });
            return response.body;
        });
        const result = await m.runArchiveMigration(plan, { approvedSha256: options.approvedSha256, client, store: getStore, openSource: f => m.openArchiveSource(source.directory, f, signal), readTarget, persist: c => journal.write("checkpoint.json", c), resume: checkpoint, signal });
        await journal.write("result.json", result);
        return { mode: "execute", status: result.status, scope: result.scope, verified: result.verified, total: result.total, issue: result.issue, sourceCollectionComplete: result.sourceCollectionComplete, newAttachmentsCreated: null };
    } finally { storageClient?.destroy(); await journal.close(); }
}
module.exports = { parseArgs, run, HELP };
if (require.main === module) {
    const control = new AbortController(); process.once("SIGINT", () => control.abort()); process.once("SIGTERM", () => control.abort());
    (async () => { const options = parseArgs(process.argv.slice(2)); if (options.help) return console.log(HELP); const result = await run(options, { signal: control.signal }); console.log(JSON.stringify(result)); if (result.status === "incomplete") process.exitCode = 2; })()
        .catch(error => { console.error(JSON.stringify({ status: "failed", code: error.code ?? "operation_uncertain" })); process.exitCode = 1; });
}
