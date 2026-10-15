import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SendbClient, SendbImportJob } from "../../../sdk/server";
import { channelOutputIdentity, type ChannelOutputIdentity } from "./output";
import type { ChannelFileManifest, ChannelFileReceipt } from "./files";
import type { ChannelTransferIdentity, ChannelTransferJobSnapshot, ChannelTransferTargetFile } from "./transfer-plan";

type ObjectValue = Record<string, unknown>;
export type ChannelTransferSourceFile = { path: string; sha256: string; size: number };
export class ChannelTransferLocalError extends Error {
    constructor(readonly code: "path" | "missing" | "integrity" | "identity" | "export_busy" | "export_incomplete" | "page_contract" | "target_changed" | "limit" | "output_exists" | "output_locked") {
        super(`첨부 보충 자료를 확인하지 못했습니다 (${code}).`);
        this.name = "ChannelTransferLocalError";
    }
}
function fail(code: ChannelTransferLocalError["code"]): never { throw new ChannelTransferLocalError(code); }
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : fail("integrity");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const hashValid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identityMatches = (value: unknown, expected: ChannelTransferIdentity) => {
    const actual = object(value);
    return actual.workspaceId === expected.workspaceId && actual.namespace === expected.namespace && actual.channelId === expected.channelId;
};
async function exists(file: string) {
    try { return await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
/** Reject links/junctions at every component, including ancestors of the nominated directory. */
export async function channelTransferDirectory(directory: string) {
    const absolute = path.resolve(directory), root = path.parse(absolute).root;
    let current = root;
    for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const info = await exists(current);
        if (!info) fail("missing");
        if (!info.isDirectory() || info.isSymbolicLink()) fail("path");
    }
    if (path.resolve(await fs.realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) fail("path");
    return absolute;
}
function relativeParts(name: string) {
    if (typeof name !== "string" || !name || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) fail("path");
    return name.split("/");
}
export async function readChannelTransferFile(directory: string, name: string, maxBytes = 256 * 1024 * 1024) {
    const root = await channelTransferDirectory(directory), parts = relativeParts(name);
    const parent = await channelTransferDirectory(path.join(root, ...parts.slice(0, -1)));
    if (parent !== root && !parent.startsWith(root + path.sep)) fail("path");
    const file = path.join(parent, parts.at(-1)!);
    const before = await exists(file);
    if (!before) fail("missing");
    if (!before.isFile() || before.isSymbolicLink()) fail("path");
    if (before.size > maxBytes) fail("integrity");
    const handle = await fs.open(file, "r");
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) fail("path");
        const bytes = await handle.readFile();
        const after = await fs.lstat(file), final = await handle.stat();
        await channelTransferDirectory(parent);
        if (after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev || final.size !== bytes.length || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs || bytes.length > maxBytes) fail("integrity");
        return bytes;
    } finally { await handle.close(); }
}
export async function readChannelTransferBytes(directory: string, receipt: ChannelFileReceipt) {
    if (!hashValid(receipt.sha256) || receipt.path !== `bytes/${receipt.sha256}.bin` || !integer(receipt.size, 1) || receipt.size > 20 * 1024 * 1024) fail("path");
    const bytes = await readChannelTransferFile(directory, receipt.path, 20 * 1024 * 1024);
    if (bytes.length !== receipt.size || sha(bytes) !== receipt.sha256) fail("integrity");
    return bytes;
}

/** Read an already closed exporter archive. This never locks, resumes or mutates that archive. */
export async function loadChannelTransferSource(directory: string, identity: ChannelTransferIdentity) {
    const root = await channelTransferDirectory(directory);
    const assertClosed = async () => { if (await exists(path.join(root, ".export.lock"))) fail("export_busy"); };
    await assertClosed();
    const sourceFiles: ChannelTransferSourceFile[] = [];
    const read = async (name: string) => {
        const bytes = await readChannelTransferFile(root, name);
        sourceFiles.push({ path: name, sha256: sha(bytes), size: bytes.length });
        try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { return fail("integrity"); }
    };
    const owner = object(await read("owner.json"));
    if (owner.formatVersion !== 1 || !identityMatches(owner.identity, identity)) fail("identity");
    const expected = channelOutputIdentity(object(owner.identity) as ChannelOutputIdentity);
    if (json(expected) !== json(owner.identity)) fail("identity");
    const sameOutputIdentity = (value: unknown) => Object.entries(expected).every(([key, expectedValue]) => object(value)[key] === expectedValue);
    const wrapped = async (name: string) => {
        const value = object(await read(name));
        if (value.formatVersion !== 1 || !sameOutputIdentity(value.identity)) fail("identity");
        if (!hashValid(value.sha256) || value.sha256 !== sha(json(value.payload))) fail("integrity");
        return value.payload;
    };
    const manifest = object(await read("manifest.json"));
    if (manifest.formatVersion !== 1 || !sameOutputIdentity(manifest.identity)) fail("identity");
    if (manifest.stage !== "finished" || manifest.sourceStatus !== "complete" || manifest.migrationApplied !== false) fail("export_incomplete");
    const imported = object(manifest.import);
    if (imported.source !== "channel" || imported.workspaceId !== identity.workspaceId || imported.namespace !== identity.namespace) fail("identity");
    const checkpoint = object(await wrapped("checkpoint.json"));
    if (checkpoint.schemaVersion !== 1 || checkpoint.apiVersion !== expected.apiVersion || checkpoint.channelId !== identity.channelId || checkpoint.pageSize !== expected.pageSize || checkpoint.status !== "complete") fail("identity");
    const raw = object(manifest.raw);
    if (!hashValid(raw.sha256) || raw.path !== `raw/${raw.sha256}.json` || !integer(raw.bytes)) fail("path");
    const bundle = await read(raw.path as string), rawFile = sourceFiles.at(-1)!;
    if (rawFile.sha256 !== raw.sha256 || rawFile.size !== raw.bytes || sha(json(checkpoint.bundle)) !== raw.sha256 || object(bundle).hasNext !== false) fail("integrity");
    for (const collection of ["users", "managers", "bots", "userChats", "messages"]) if (!Array.isArray(object(bundle)[collection])) fail("integrity");
    const pages = await wrapped("pages-index.json");
    if (!Array.isArray(pages) || object(manifest.pages).index !== "pages-index.json" || object(manifest.pages).scopes !== pages.length) fail("integrity");
    const pageKeys = new Set<string>();
    for (const input of pages) {
        const page = object(input), scope = { path: page.path, query: page.query, apiVersion: page.apiVersion };
        if (!hashValid(page.key) || pageKeys.has(page.key) || sha(json(scope)) !== page.key || page.apiVersion !== expected.apiVersion || !Array.isArray(page.versions) || !page.versions.length) fail("integrity");
        pageKeys.add(page.key);
        for (const entry of page.versions) {
            const version = object(entry);
            if (!hashValid(version.sha256) || version.path !== `pages/${page.key}-${version.sha256}.json`) fail("path");
            const saved = object(await read(version.path as string)), snapshot = sourceFiles.at(-1)!;
            if (snapshot.sha256 !== version.sha256 || snapshot.size !== version.bytes || saved.path !== page.path || json(saved.query) !== json(page.query) || saved.apiVersion !== expected.apiVersion || saved.status !== 200) fail("integrity");
        }
    }
    for (const rawEntry of Object.values(object(checkpoint.ledger))) {
        const entry = object(rawEntry);
        if (entry.status !== "complete" || !Array.isArray(entry.seenCursors) || entry.pages !== entry.seenCursors.length) fail("export_incomplete");
        for (const cursor of entry.seenCursors) {
            const query = Object.fromEntries(Object.entries({ ...object(entry.query), ...(cursor === null ? {} : { cursor }) }).sort(([a], [b]) => a.localeCompare(b)));
            if (!pageKeys.has(sha(json({ path: entry.path, query, apiVersion: expected.apiVersion })))) fail("integrity");
        }
    }
    if (!Array.isArray(manifest.chunks)) fail("integrity");
    for (const value of manifest.chunks) {
        const chunk = object(value);
        if (typeof chunk.path !== "string" || !/^chunks\/\d{5,8}-(contacts|conversations|messages)\.json$/.test(chunk.path) || !hashValid(chunk.sha256)) fail("path");
        await read(chunk.path);
        const snapshot = sourceFiles.at(-1)!;
        if (snapshot.sha256 !== chunk.sha256 || snapshot.size !== chunk.bytes) fail("integrity");
    }
    if (object(manifest.files).path !== "files.json") fail("export_incomplete");
    const filesResult = object(await wrapped("files.json")), filesManifest = object(filesResult.manifest);
    if (object(manifest.files).status !== filesResult.status) fail("integrity");
    const filesCheckpoint = await wrapped("files-checkpoint.json");
    if (json(filesCheckpoint) !== json(filesManifest) || filesManifest.version !== 1 || filesManifest.source !== "channel" || filesManifest.apiVersion !== expected.apiVersion || filesManifest.channelId !== identity.channelId || !Array.isArray(filesManifest.files)) fail("integrity");
    const localIssues: { id: string; code: string }[] = [];
    const visited = new Set<string>();
    for (const rawRow of filesManifest.files) {
        const row = object(rawRow);
        if (typeof row.id !== "string" || visited.has(row.id)) fail("integrity");
        visited.add(row.id);
        if (row.receipt === undefined) continue;
        try { await readChannelTransferBytes(root, object(row.receipt) as ChannelFileReceipt); }
        catch (error) {
            if (!(error instanceof ChannelTransferLocalError)) throw error;
            // Traversal/link attempts are fatal; missing/corrupt bytes are reviewable blocked rows.
            if (error.code === "path") throw error;
            localIssues.push({ id: row.id, code: error.code === "missing" ? "local_bytes_missing" : "local_bytes_corrupt" });
        }
    }
    // Metadata cannot change underneath the initial validation pass.
    for (const file of sourceFiles) if (sha(await readChannelTransferFile(root, file.path)) !== file.sha256) fail("integrity");
    await assertClosed();
    return { directory: root, bundle, manifest: filesManifest as ChannelFileManifest, sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)), localIssues };
}

export type ChannelTransferReadClient = Pick<SendbClient, "imports" | "import" | "importFiles">;
function pageJob(raw: unknown, id: string, identity: ChannelTransferIdentity): SendbImportJob {
    const job = object(raw);
    if (job.id !== id || job.workspaceId !== identity.workspaceId || job.source !== "channel" || job.namespace !== identity.namespace) fail("identity");
    if (!integer(job.version, 1) || !integer(job.total) || !integer(job.cursor) || !hashValid(job.fingerprint) || !Array.isArray(job.rows) || !Array.isArray(job.results) || typeof job.hasMore !== "boolean") fail("page_contract");
    return raw as SendbImportJob;
}
function jobStamp(job: SendbImportJob) { return json([job.id, job.workspaceId, job.namespace, job.source, job.state, job.version, job.total, job.cursor, job.fingerprint]); }
export function channelTransferTargetFile(raw: unknown, jobId: string, identity: ChannelTransferIdentity): ChannelTransferTargetFile {
    const file = object(raw), locator = object(file.locator);
    if (file.jobId !== jobId || file.workspaceId !== identity.workspaceId) fail("identity");
    if (typeof file.id !== "string" || !file.id || !integer(file.version, 1) || !integer(file.messageId, 1) || typeof file.sourceKey !== "string" || !hashValid(file.manifest) || typeof file.fileName !== "string" || typeof file.active !== "boolean" || typeof file.metadataValid !== "boolean" || !["pending", "fetching", "ready", "failed", "needs_source"].includes(String(file.state)) || typeof locator.originalId !== "string" || !(locator.key === null || typeof locator.key === "string") || !integer(locator.index) || typeof locator.conversationId !== "string" || typeof locator.messageSourceId !== "string") fail("page_contract");
    return raw as ChannelTransferTargetFile;
}
export async function readChannelTransferJob(client: ChannelTransferReadClient, identity: ChannelTransferIdentity, id: string, signal?: AbortSignal): Promise<ChannelTransferJobSnapshot> {
    signal?.throwIfAborted();
    const first = pageJob(await client.import(id, 0), id, identity), rows: SendbImportJob["rows"] = [], results: SendbImportJob["results"] = [];
    const rowIds = new Set<number>(), resultIds = new Set<number>();
    let page = first, offset = 0;
    for (let count = 0; ; count++) {
        signal?.throwIfAborted();
        if (count > 10000) fail("limit");
        if (jobStamp(page) !== jobStamp(first)) fail("target_changed");
        if (page.rows.length > 100 || (page.hasMore && page.rows.length === 0)) fail("page_contract");
        for (const row of page.rows) {
            if (row.index !== rows.length || rowIds.has(row.index)) fail("page_contract");
            rowIds.add(row.index); rows.push(row);
        }
        for (const result of page.results) {
            if (!page.rows.some(row => row.index === result.position) || resultIds.has(result.position)) fail("page_contract");
            resultIds.add(result.position); results.push(result);
        }
        offset += page.rows.length;
        if (page.hasMore !== (offset < first.total)) fail("page_contract");
        if (!page.hasMore) break;
        page = pageJob(await client.import(id, offset), id, identity);
    }
    if (rows.length !== first.total) fail("page_contract");
    const files: ChannelTransferTargetFile[] = [], ids = new Set<string>();
    let total: number | undefined;
    for (let count = 0; ; count++) {
        signal?.throwIfAborted();
        if (count > 10000) fail("limit");
        const current = object(await client.importFiles(id, files.length));
        if (!Array.isArray(current.rows) || !integer(current.total) || current.offset !== files.length || typeof current.hasMore !== "boolean" || current.rows.length > 100 || (current.hasMore && current.rows.length === 0)) fail("page_contract");
        if (total !== undefined && total !== current.total) fail("target_changed");
        total = current.total;
        for (const raw of current.rows) { const file = channelTransferTargetFile(raw, id, identity); if (ids.has(file.id)) fail("page_contract"); ids.add(file.id); files.push(file); }
        if (current.hasMore !== (files.length < total)) fail("page_contract");
        if (!current.hasMore) break;
    }
    if (files.length !== total) fail("page_contract");
    signal?.throwIfAborted();
    if (jobStamp(pageJob(await client.import(id, 0), id, identity)) !== jobStamp(first)) fail("target_changed");
    return { job: { ...first, rows, results }, files, rowsComplete: true, filesComplete: true };
}
export async function collectChannelTransferJobs(client: ChannelTransferReadClient, identity: ChannelTransferIdentity, options: { jobIds?: string[]; signal?: AbortSignal } = {}) {
    const ids: string[] = [], seen = new Set<string>();
    if (options.jobIds) {
        for (const id of options.jobIds) { if (!id || seen.has(id)) fail("page_contract"); seen.add(id); ids.push(id); }
    } else {
        let before: string | undefined;
        for (let count = 0; ; count++) {
            options.signal?.throwIfAborted();
            if (count > 10000) fail("limit");
            const page = object(await client.imports(identity.workspaceId, before));
            if (!Array.isArray(page.rows) || typeof page.hasMore !== "boolean" || page.rows.length > 50 || (page.hasMore && !page.rows.length)) fail("page_contract");
            for (const raw of page.rows) {
                const row = object(raw);
                if (typeof row.id !== "string" || !row.id || seen.has(row.id)) fail("page_contract");
                seen.add(row.id);
                if (row.source === "channel" && row.namespace === identity.namespace) ids.push(row.id);
                before = row.id;
            }
            if (!page.hasMore) break;
        }
    }
    const jobs: ChannelTransferJobSnapshot[] = [];
    for (const id of ids) jobs.push(await readChannelTransferJob(client, identity, id, options.signal));
    return jobs;
}

/** The journal has its own directory/owner/lock; exporter files are never written. */
export async function openChannelTransferJournal(directory: string, identity: ChannelTransferIdentity, resume = false) {
    const absolute = path.resolve(directory);
    if (!await exists(absolute)) { await channelTransferDirectory(path.dirname(absolute)); await fs.mkdir(absolute); }
    const root = await channelTransferDirectory(absolute), ownerFile = path.join(root, "transfer-owner.json");
    const owner = { version: 1, identity };
    if (!resume) {
        if ((await fs.readdir(root)).length) fail("output_exists");
        await fs.writeFile(ownerFile, json(owner), { flag: "wx", mode: 0o600 });
    } else if (json(JSON.parse((await readChannelTransferFile(root, "transfer-owner.json")).toString())) !== json(owner)) fail("identity");
    const nonce = randomUUID(), lock = path.join(root, "transfer.lock");
    try { await fs.writeFile(lock, json({ nonce, pid: process.pid }), { flag: "wx", mode: 0o600 }); } catch { fail("output_locked"); }
    const assertLock = async () => { if (object(JSON.parse((await readChannelTransferFile(root, "transfer.lock")).toString())).nonce !== nonce) fail("output_locked"); };
    return {
        directory: root,
        async read(name: "plan.json" | "checkpoint.json") { try { return JSON.parse((await readChannelTransferFile(root, name)).toString()) as unknown; } catch (error) { if (error instanceof ChannelTransferLocalError && error.code === "missing") return undefined; throw error; } },
        async write(name: "plan.json" | "checkpoint.json" | "result.json" | "fixture-state.json", value: unknown) {
            await assertLock(); await channelTransferDirectory(root);
            const target = path.join(root, name), current = await exists(target);
            if (current && (!current.isFile() || current.isSymbolicLink() || name === "plan.json")) fail("output_exists");
            const temporary = path.join(root, `.transfer-${randomUUID()}`);
            try {
                const handle = await fs.open(temporary, "wx", 0o600);
                try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
                await assertLock(); await fs.rename(temporary, target);
            } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
        },
        async close() { await assertLock(); await fs.unlink(lock); },
    };
}
