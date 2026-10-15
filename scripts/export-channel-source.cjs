/* eslint-disable @typescript-eslint/no-require-imports -- Standalone offline-first export entry point; no dotenv or application bootstrap. */
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const VERSION = "2026-06-01";
class ChannelExportCliError extends Error {
    constructor(code) { super("채널톡 내보내기를 실행하지 못했습니다."); this.code = code; }
}
function loadModules() {
    // Resolve the repository's existing tsx runtime even when invoked from another directory.
    const previous = process.env.TSX_TSCONFIG_PATH;
    process.env.TSX_TSCONFIG_PATH = path.join(root, "tsconfig.json");
    try {
        const scopedRequire = require("tsx/cjs/api").require;
        const load = file => scopedRequire(path.join(root, file), __filename);
        return {
            ...load("src/lib/customer-imports/channel-export.ts"),
            ...load("src/lib/channel-source-export/chunks.ts"),
            ...load("src/lib/channel-source-export/output.ts"),
            ...load("src/lib/channel-source-export/http.ts"),
            ...load("src/lib/channel-source-export/collector-request.ts"),
            ...load("src/lib/channel-source-export/files.ts"),
            ...load("src/lib/customer-import-files/transport.ts"),
        };
    } finally {
        if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH;
        else process.env.TSX_TSCONFIG_PATH = previous;
    }
}
const ordered = value => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));
const clone = value => structuredClone(value);
function fixtureDownloads(fixture) {
    const rows = [];
    for (const source of fixture.downloads ?? []) {
        if (source.chatId && source.key && source.url) { rows.push(source); continue; }
        if (!fixture.fictional || !source.fileId) throw new ChannelExportCliError("fixture");
        for (const message of fixture.bundle?.messages ?? [])
            for (const file of message.files ?? [])
                if (String(file.id) === String(source.fileId)) {
                    const locator = [message.chatId, file.key, file.id];
                    const id = createHash("sha256").update(JSON.stringify(locator)).digest("hex");
                    rows.push({ ...source, chatId: message.chatId, key: file.key, url: `https://files.example.test/${id}` });
                }
    }
    return rows;
}
function createFixtureRequest(fixture) {
    if (!fixture || typeof fixture !== "object" || typeof fixture.channelId !== "string" || (!Array.isArray(fixture.responses) && (!fixture.fictional || !fixture.bundle))) throw new ChannelExportCliError("fixture");
    if (!Array.isArray(fixture.responses) && (fixture.bundle.hasNext !== false || fixture.bundle.next || fixture.bundle.nextCursor)) throw new ChannelExportCliError("source_incomplete");
    const used = new Set(), calls = [], downloads = fixtureDownloads(fixture);
    const request = async input => {
        input.signal?.throwIfAborted();
        if (input.method !== "GET" || input.headers?.["Channel-Version"] !== VERSION || !input.path?.startsWith("/open/")) throw new ChannelExportCliError("fixture_request");
        calls.push(clone({ path: input.path, query: input.query ?? {} }));
        if (Array.isArray(fixture.responses)) {
            const index = fixture.responses.findIndex((row, i) => !used.has(i) && row.path === input.path && ordered(row.query) === ordered(input.query));
            if (index >= 0) {
                used.add(index); const row = fixture.responses[index];
                return { status: row.status, headers: clone(row.headers ?? {}), body: clone(row.body) };
            }
        }
        const fileChat = /^\/open\/user-chats\/([^/]+)\/messages\/file$/.exec(input.path)?.[1];
        if (fileChat) {
            const source = downloads.find(row => row.chatId === decodeURIComponent(fileChat) && row.key === input.query?.key);
            return source ? { status: 200, headers: {}, body: { result: source.url } } : { status: 404, headers: {}, body: {} };
        }
        if (Array.isArray(fixture.responses)) throw new ChannelExportCliError("fixture_missing_response");
        const bundle = fixture.bundle;
        for (const key of ["users", "managers", "bots", "userChats", "messages"]) if (!Array.isArray(bundle[key])) throw new ChannelExportCliError("fixture");
        const page = (kind, rows) => {
            const query = input.query ?? {}, limit = query.limit;
            const cursor = query.cursor, offset = cursor === undefined ? 0 : /^fixture:\d+$/.test(cursor) ? Number(cursor.slice(8)) : NaN;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ChannelExportCliError("fixture_cursor");
            const values = rows.slice(offset, offset + limit), hasNext = offset + limit < rows.length;
            return { status: 200, headers: {}, body: { [kind]: clone(values), hasNext, nextCursor: hasNext ? `fixture:${offset + limit}` : null, ...(kind === "messages" ? { bots: clone(bundle.bots.filter(bot => values.some(message => message.personType === "bot" && message.personId === bot.id))) } : {}) } };
        };
        if (input.path === "/open/channel") return { status: 200, headers: {}, body: { channel: { id: fixture.channelId, name: "허구 채널 내보내기 검수" } } };
        if (input.path === "/open/managers") return page("managers", bundle.managers);
        if (input.path === "/open/user-chats") {
            if (!["opened", "closed", "snoozed", "queued", "initial", "missed"].includes(input.query?.state) || input.query?.dateTimeFieldName !== "deskUpdatedAt" || input.query?.sortOrder !== "asc") throw new ChannelExportCliError("fixture_query");
            return page("userChats", bundle.userChats.filter(chat => chat.state === input.query.state));
        }
        const chatId = /^\/open\/user-chats\/([^/]+)\/messages$/.exec(input.path)?.[1];
        if (chatId) return page("messages", bundle.messages.filter(message => message.chatId === decodeURIComponent(chatId)));
        const userId = /^\/open\/users\/([^/]+)$/.exec(input.path)?.[1];
        if (userId) {
            const user = bundle.users.find(row => row.id === decodeURIComponent(userId));
            return user ? { status: 200, headers: {}, body: { user: clone(user) } } : { status: 404, headers: {}, body: {} };
        }
        throw new ChannelExportCliError("fixture_missing_response");
    };
    request.calls = calls;
    return request;
}
function createFixtureDownload(fixture) {
    const downloads = fixtureDownloads(fixture);
    return async (url, { signal, maxBytes }) => {
        signal?.throwIfAborted();
        const source = downloads.find(row => row.url === url);
        if (!source || typeof source.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.base64)) throw new ChannelExportCliError("fixture_missing_bytes");
        if (source.base64.length > Math.ceil(maxBytes / 3) * 4) throw new ChannelExportCliError("fixture_bytes_limit");
        const bytes = Buffer.from(source.base64, "base64");
        if (!bytes.length || bytes.length > maxBytes) throw new ChannelExportCliError("fixture_bytes_limit");
        return bytes;
    };
}
function parseArgs(argv) {
    const values = {}, flags = new Set(["resume", "recover-stale-lock", "include-files", "run", "help"]);
    const names = new Set(["fixture", "out", "channel-id", "namespace", "workspace-id", "page-size", "max-requests"]);
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i];
        if (!argument.startsWith("--")) throw new ChannelExportCliError("arguments");
        const name = argument.slice(2);
        if (Object.hasOwn(values, name)) throw new ChannelExportCliError("arguments");
        if (flags.has(name)) values[name] = true;
        else if (names.has(name) && argv[i + 1] && !argv[i + 1].startsWith("--")) values[name] = argv[++i];
        else throw new ChannelExportCliError("arguments");
    }
    if (values.help) return { help: true };
    if (!values.out || !values["channel-id"] || !values.namespace || (!!values.run === !!values.fixture) || (values["recover-stale-lock"] && !values.resume) || (values.run && !values["workspace-id"])) throw new ChannelExportCliError("arguments");
    const integer = (name, fallback, min, max) => {
        const value = values[name] ?? fallback;
        if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new ChannelExportCliError("arguments");
        return Number(value);
    };
    return { fixture: values.fixture, out: values.out, channelId: values["channel-id"], namespace: values.namespace, workspaceId: integer("workspace-id", 8, 1, Number.MAX_SAFE_INTEGER), pageSize: integer("page-size", 100, 1, 500), maxRequests: integer("max-requests", 50000, 1, 100000), resume: !!values.resume, recoverStaleLock: !!values["recover-stale-lock"], includeFiles: !!values["include-files"], run: !!values.run };
}
const HELP = `Channel source export (read-only; no CRM import or deployment)
Offline:
  node scripts/export-channel-source.cjs --fixture scripts/fixtures/channel-source-export-fictional.json --out .testenv/channel-export-demo --channel-id qa-fictional-channel-export --namespace fictional-demo
Options: --workspace-id 8 --page-size 100 --max-requests 50000 --resume --recover-stale-lock --include-files
Actual account access requires --run instead of --fixture, explicit --workspace-id, and environment variables CHANNEL_SOURCE_ACCESS_KEY / CHANNEL_SOURCE_ACCESS_SECRET. No .env files are loaded.
Bundle fixtures must declare fictional:true. Response fixtures use {channelId,responses:[{path,query,status,headers?,body}],downloads?:[{chatId,key,url,base64}]}.
Output: full successful source pages, raw bundle, checkpoint, dependency-ordered importer chunks and manifest. Complete means selected endpoint cursor coverage; it does not prove all-customer coverage. Attachments need --include-files and a separate complete byte manifest.\n`;
const SAFE_CODES = new Set(["arguments", "fixture", "fixture_request", "fixture_cursor", "fixture_query", "fixture_missing_response", "fixture_missing_bytes", "fixture_bytes_limit", "credentials", "identity", "collision", "locked", "checkpoint", "path", "bytes", "closed", "configuration", "request", "version", "redirect", "too_large", "json", "timeout", "aborted", "network", "archive", "source_incomplete", "source_invalid", "duplicate_source", "missing_dependency", "row_invalid", "item_too_large"]);
const safeCode = error => SAFE_CODES.has(error?.code) ? error.code : "export_failed";
async function runExport(options, dependencies = {}) {
    const modules = loadModules(), signal = dependencies.signal;
    const identity = modules.channelOutputIdentity(options);
    let fixture, httpRequest, download;
    if (options.run) {
        const accessKey = process.env.CHANNEL_SOURCE_ACCESS_KEY, accessSecret = process.env.CHANNEL_SOURCE_ACCESS_SECRET;
        if (!accessKey || !accessSecret) throw new ChannelExportCliError("credentials");
        httpRequest = modules.createChannelSourceRequest({ accessKey, accessSecret });
        download = async (url, { signal: downloadSignal, maxBytes }) => {
            downloadSignal.throwIfAborted();
            const transport = modules.createImportFileTransport({ signal: downloadSignal, maxBytes });
            const bytes = await transport(url); downloadSignal.throwIfAborted();
            if (bytes.length > maxBytes) throw new ChannelExportCliError("fixture_bytes_limit");
            return bytes;
        };
    } else {
        const info = await fs.stat(options.fixture);
        if (!info.isFile() || info.size > 256 * 1024 * 1024) throw new ChannelExportCliError("fixture");
        try { fixture = JSON.parse(await fs.readFile(options.fixture, "utf8")); } catch { throw new ChannelExportCliError("fixture"); }
        if (fixture.channelId !== identity.channelId) throw new ChannelExportCliError("identity");
        httpRequest = createFixtureRequest(fixture); download = createFixtureDownload(fixture);
    }
    const output = await modules.openChannelOutput(options.out, identity, options);
    let virtualNow = 0;
    const sleep = options.run ? (ms, currentSignal) => delay(ms, undefined, { signal: currentSignal }) : async (ms, currentSignal) => { currentSignal?.throwIfAborted(); virtualNow += ms; };
    try {
        const request = modules.createChannelCollectorRequest(httpRequest, { savePage: output.saveSourcePage, expectedChannelId: identity.channelId });
        const exported = await modules.exportChannelData({ channelId: identity.channelId, request, sleep, checkpoint: output.writeCheckpoint, resume: output.checkpoint, limits: { pageSize: identity.pageSize, maxRequests: options.maxRequests }, signal, ...(!options.run ? { now: () => virtualNow } : {}) });
        let plan, issue, files;
        if (exported.status === "complete") {
            try { plan = modules.splitChannelBundle(exported.bundle, identity); }
            catch (error) {
                if (!(error instanceof modules.ChannelChunkError)) throw error;
                issue = { code: error.code, detail: error.detail };
            }
            if (options.includeFiles) files = await modules.backupChannelFiles(exported.bundle, { channelId: identity.channelId, sourceStatus: exported.status, request: httpRequest, download, save: output.saveBytes, verify: output.verifyBytes, resume: output.filesResume, checkpoint: output.writeFilesCheckpoint, sleep: (ms, current) => sleep(ms, current.signal), signal });
        }
        const manifest = await output.publish(exported, plan, files, issue);
        return { status: exported.status, importStatus: manifest.importStatus, importReady: manifest.importReady, sourceCounts: exported.counts, chunks: plan?.chunks.length ?? 0, files: manifest.files, issue: issue?.code, manifest: path.join(output.directory, "manifest.json"), migrationApplied: false, exitCode: exported.status === "complete" && !issue && (!options.includeFiles || files?.status === "complete") ? 0 : 2 };
    } catch (error) { try { await output.fail(safeCode(error)); } catch {} throw error; }
    finally { await output.close(); }
}
async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(HELP); return 0; }
    const controller = new AbortController(), abort = () => controller.abort();
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try { const summary = await runExport(options, { signal: controller.signal }); process.stdout.write(JSON.stringify(summary) + "\n"); return summary.exitCode; }
    finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
module.exports = { createFixtureRequest, createFixtureDownload, parseArgs, runExport, main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(JSON.stringify({ status: "failed", code: safeCode(error), migrationApplied: false }) + "\n"); process.exitCode = 1; });
