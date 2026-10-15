import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hostname } from "node:os";
import { createImportInput } from "@/lib/customer-imports/rules";
import type { ChannelChunkPlan } from "./chunks";

export const CHANNEL_OUTPUT_VERSION = 1;
export const CHANNEL_OUTPUT_API_VERSION = "2026-06-01";
type Status = "complete" | "incomplete" | "failed" | "aborted";
export type ChannelOutputIdentity = {
    formatVersion: 1; apiVersion: "2026-06-01";
    channelId: string; namespace: string; pageSize: number; workspaceId: number;
};
export type ChannelBytesReceipt = { path: string; sha256: string; size: number };
type PageVersion = { path: string; sha256: string; bytes: number };
type PageEntry = { key: string; path: string; query: Record<string, string | number>; apiVersion: string; versions: PageVersion[] };
export class ChannelOutputError extends Error {
    constructor(readonly code: "identity" | "collision" | "locked" | "checkpoint" | "path" | "bytes" | "closed") {
        super(`채널톡 내보내기 파일을 처리하지 못했습니다 (${code}).`);
        this.name = "ChannelOutputError";
    }
}
const json = (value: unknown) => {
    try { const result = JSON.stringify(value); if (!result) throw new Error(); return result; }
    catch { throw new ChannelOutputError("checkpoint"); }
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelOutputError("checkpoint");
    return value as Record<string, unknown>;
};
export function channelOutputIdentity(input: { channelId: string; namespace: string; pageSize?: number; workspaceId: number }): ChannelOutputIdentity {
    const parsed = createImportInput.parse({ workspaceId: input.workspaceId, source: "channel", namespace: input.namespace, content: "{}" });
    const pageSize = input.pageSize ?? 100;
    if (typeof input.channelId !== "string" || !input.channelId || input.channelId.length > 2048 || /[\x00-\x20\x7f]/.test(input.channelId) || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new ChannelOutputError("identity");
    return { formatVersion: 1, apiVersion: CHANNEL_OUTPUT_API_VERSION, channelId: input.channelId, namespace: parsed.namespace, pageSize, workspaceId: parsed.workspaceId };
}
const sameIdentity = (left: unknown, right: ChannelOutputIdentity) => {
    const value = object(left);
    return Object.keys(right).every(key => value[key] === right[key as keyof ChannelOutputIdentity]);
};
const status = (value: unknown): Status => {
    if (!["complete", "incomplete", "failed", "aborted"].includes(String(value))) throw new ChannelOutputError("checkpoint");
    return value as Status;
};
function pageScope(input: { path: unknown; query: unknown; apiVersion: unknown }, apiVersion: string) {
    if (input.apiVersion !== apiVersion || typeof input.path !== "string" || !input.path.startsWith("/open/") || /[?#\\\x00-\x20\x7f]/.test(input.path) || /\/messages\/file\/?$/.test(input.path)) throw new ChannelOutputError("checkpoint");
    const allowed = new Set(["cursor", "limit", "state", "dateTimeFieldName", "sortOrder", "since", "until"]);
    const query: Record<string, string | number> = {}, source = object(input.query);
    for (const key of Object.keys(source).sort()) {
        const value = source[key];
        if (!allowed.has(key) || !["string", "number"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) throw new ChannelOutputError("checkpoint");
        query[key] = value as string | number;
    }
    return { path: input.path, query, apiVersion };
}
function validateCheckpoint(value: unknown, identity: ChannelOutputIdentity) {
    const state = object(value);
    if (state.schemaVersion !== 1 || state.apiVersion !== identity.apiVersion || state.channelId !== identity.channelId || state.pageSize !== identity.pageSize || !Number.isSafeInteger(state.requestCount) || Number(state.requestCount) < 0) throw new ChannelOutputError("checkpoint");
    const phase = status(state.status), bundle = object(state.bundle), ledger = object(state.ledger);
    for (const name of ["users", "managers", "bots", "userChats", "messages"])
        if (!Array.isArray(bundle[name])) throw new ChannelOutputError("checkpoint");
    if (typeof bundle.hasNext !== "boolean" || (phase === "complete") === bundle.hasNext) throw new ChannelOutputError("checkpoint");
    for (const entry of Object.values(ledger)) {
        const row = object(entry);
        if (typeof row.path !== "string" || !row.path.startsWith("/open/") || !row.query || !["pending", "complete", "failed"].includes(String(row.status)) || !Array.isArray(row.seenCursors) || !Number.isSafeInteger(row.pages) || Number(row.pages) < 0 || row.pages !== row.seenCursors.length || (phase === "complete" && row.status !== "complete")) throw new ChannelOutputError("checkpoint");
    }
    return state;
}
async function exists(file: string) {
    try { return await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function readObject(file: string) {
    const info = await exists(file);
    if (!info?.isFile() || info.isSymbolicLink()) throw new ChannelOutputError("path");
    try { return object(JSON.parse(await fs.readFile(file, "utf8"))); } catch (error) { if (error instanceof ChannelOutputError) throw error; throw new ChannelOutputError("checkpoint"); }
}
async function fileDigest(file: string) {
    const digest = createHash("sha256"); let size = 0;
    for await (const chunk of createReadStream(file)) { digest.update(chunk); size += chunk.length; }
    return { sha256: digest.digest("hex"), size };
}
function alive(pid: number) {
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export async function openChannelOutput(
    directory: string,
    inputIdentity: ChannelOutputIdentity,
    options: { resume?: boolean; recoverStaleLock?: boolean } = {},
) {
    const identity = channelOutputIdentity(inputIdentity);
    if (!sameIdentity(inputIdentity, identity)) throw new ChannelOutputError("identity");
    const absolute = path.resolve(directory);
    await fs.mkdir(absolute, { recursive: true });
    const directoryInfo = await fs.lstat(absolute);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new ChannelOutputError("path");
    const root = await fs.realpath(absolute), ownerPath = path.join(root, "owner.json"), ownerInfo = await exists(ownerPath);
    if (!options.resume) {
        if ((await fs.readdir(root)).length) throw new ChannelOutputError("collision");
        await fs.writeFile(ownerPath, json({ formatVersion: 1, identity, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    } else {
        if (!ownerInfo) throw new ChannelOutputError("identity");
        const owner = await readObject(ownerPath);
        if (owner.formatVersion !== 1 || !sameIdentity(owner.identity, identity)) throw new ChannelOutputError("identity");
    }
    const lockPath = path.join(root, ".export.lock"), nonce = randomUUID();
    const lock = { formatVersion: 1, identity, nonce, pid: process.pid, host: hostname() };
    try {
        await fs.writeFile(lockPath, json(lock), { flag: "wx", mode: 0o600 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const previous = await readObject(lockPath);
        if (!options.resume || !options.recoverStaleLock || previous.formatVersion !== 1 || !sameIdentity(previous.identity, identity) || previous.host !== hostname() || !Number.isSafeInteger(previous.pid) || Number(previous.pid) < 1 || alive(Number(previous.pid))) throw new ChannelOutputError("locked");
        const quarantine = path.join(root, `.stale-lock-${randomUUID()}.json`);
        await fs.rename(lockPath, quarantine);
        const moved = await readObject(quarantine);
        if (moved.nonce !== previous.nonce) {
            try { await fs.link(quarantine, lockPath); } catch {}
            throw new ChannelOutputError("locked");
        }
        try { await fs.writeFile(lockPath, json(lock), { flag: "wx", mode: 0o600 }); }
        catch { throw new ChannelOutputError("locked"); }
    }
    let closed = false, closing = false;
    let pending: Promise<unknown> = Promise.resolve();
    const queued = <T>(run: () => Promise<T>): Promise<T> => {
        if (closing) return Promise.reject(new ChannelOutputError("closed"));
        // Enqueue before any I/O: delayed archive callbacks must not overwrite newer indexes.
        const operation = pending.then(run);
        pending = operation.catch(() => {});
        return operation;
    };
    const assertLock = async () => {
        if (closed) throw new ChannelOutputError("closed");
        const current = await readObject(lockPath);
        if (current.nonce !== nonce || !sameIdentity(current.identity, identity)) throw new ChannelOutputError("locked");
    };
    const subdirectory = async (name: "chunks" | "raw" | "bytes" | "pages") => {
        const target = path.join(root, name);
        await fs.mkdir(target, { recursive: true });
        const info = await fs.lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(target) !== target) throw new ChannelOutputError("path");
        return target;
    };
    const atomic = async (name: string, content: string | Uint8Array, immutable = false) => {
        await assertLock();
        if (!/^(?:[a-z][a-z.-]*\.json|(?:raw|bytes)\/[a-f0-9]{64}\.(?:json|bin)|pages\/[a-f0-9]{64}-[a-f0-9]{64}\.json|chunks\/\d{5,8}-(?:contacts|conversations|messages)\.json)$/.test(name)) throw new ChannelOutputError("path");
        const parts = name.split("/");
        if (parts.length > 1) await subdirectory(parts[0] as "chunks" | "raw" | "bytes" | "pages");
        const target = path.join(root, ...parts), current = await exists(target);
        if (current && (!current.isFile() || current.isSymbolicLink())) throw new ChannelOutputError("path");
        if (current && !immutable) {
            const previous = await readObject(target);
            if (previous.formatVersion !== 1 || !sameIdentity(previous.identity, identity)) throw new ChannelOutputError("collision");
        }
        if (immutable && current) {
            const digest = await fileDigest(target);
            if (digest.sha256 !== hash(content) || digest.size !== (typeof content === "string" ? Buffer.byteLength(content) : content.byteLength)) throw new ChannelOutputError("collision");
            return;
        }
        const temporary = path.join(path.dirname(target), `.tmp-${randomUUID()}`);
        try {
            const handle = await fs.open(temporary, "wx", 0o600);
            try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
            await assertLock(); await fs.rename(temporary, target);
        }
        finally { try { await fs.unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    };
    const wrapped = (payload: unknown) => ({ formatVersion: 1, identity, capturedAt: new Date().toISOString(), sha256: hash(json(payload)), payload });
    const resumePayload = async (name: string) => {
        const target = path.join(root, name);
        if (!await exists(target)) return undefined;
        const value = await readObject(target);
        if (value.formatVersion !== 1 || !sameIdentity(value.identity, identity) || value.sha256 !== hash(json(value.payload))) throw new ChannelOutputError("checkpoint");
        return value.payload;
    };
    try {
        const checkpoint = options.resume ? await resumePayload("checkpoint.json") : undefined;
        if (checkpoint) validateCheckpoint(checkpoint, identity);
        const filesResume = options.resume ? await resumePayload("files-checkpoint.json") : undefined;
        const savedPages = options.resume ? await resumePayload("pages-index.json") : undefined;
        const pages = new Map<string, PageEntry>();
        if (savedPages !== undefined) {
            if (!Array.isArray(savedPages)) throw new ChannelOutputError("checkpoint");
            await subdirectory("pages");
            for (const raw of savedPages) {
                const entry = object(raw) as unknown as PageEntry;
                if (!/^[a-f0-9]{64}$/.test(entry.key) || !Array.isArray(entry.versions) || !entry.versions.length || entry.key !== hash(json(pageScope(entry, identity.apiVersion))) || pages.has(entry.key)) throw new ChannelOutputError("checkpoint");
                for (const version of entry.versions) {
                    if (version.path !== `pages/${entry.key}-${version.sha256}.json` || !/^[a-f0-9]{64}$/.test(version.sha256)) throw new ChannelOutputError("checkpoint");
                    const target = path.join(root, ...version.path.split("/")), info = await exists(target);
                    if (!info?.isFile() || info.isSymbolicLink()) throw new ChannelOutputError("path");
                    const digest = await fileDigest(target);
                    if (digest.sha256 !== version.sha256 || digest.size !== version.bytes) throw new ChannelOutputError("checkpoint");
                    const page = await readObject(target);
                    if (page.path !== entry.path || json(page.query) !== json(entry.query) || page.apiVersion !== entry.apiVersion || page.status !== 200) throw new ChannelOutputError("checkpoint");
                }
                pages.set(entry.key, entry);
            }
        }
        const validatePageCoverage = (state: Record<string, unknown>) => {
            for (const raw of Object.values(object(state.ledger))) {
                const entry = object(raw);
                for (const cursor of entry.seenCursors as unknown[]) {
                    if (cursor !== null && typeof cursor !== "string") throw new ChannelOutputError("checkpoint");
                    const scope = pageScope({ path: entry.path, query: { ...object(entry.query), ...(cursor === null ? {} : { cursor }) }, apiVersion: identity.apiVersion }, identity.apiVersion);
                    if (!pages.has(hash(json(scope)))) throw new ChannelOutputError("checkpoint");
                }
            }
        };
        if (checkpoint) validatePageCoverage(object(checkpoint));
        await atomic("manifest.json", json({ formatVersion: 1, identity, stage: "collecting", importReady: false, migrationApplied: false }));
        return {
            directory: root, identity, checkpoint, filesResume,
            writeCheckpoint(state: unknown) { return queued(async () => {
                validatePageCoverage(validateCheckpoint(state, identity));
                await atomic("checkpoint.json", json(wrapped(state)));
            }); },
            writeFilesCheckpoint(manifest: unknown) { return queued(async () => {
                const value = object(manifest);
                if (value.version !== 1 || value.apiVersion !== identity.apiVersion || value.channelId !== identity.channelId || !Array.isArray(value.files)) throw new ChannelOutputError("checkpoint");
                await atomic("files-checkpoint.json", json(wrapped(manifest)));
            }); },
            saveSourcePage(input: { path: string; query: Record<string, string | number>; apiVersion: string; status: number; body: unknown }) { return queued(async () => {
                if (input.status !== 200) throw new ChannelOutputError("checkpoint");
                // Select fields explicitly: request headers/access credentials are never archived.
                const scope = pageScope(input, identity.apiVersion), key = hash(json(scope));
                const record = { ...scope, status: 200, body: input.body }, content = json(record), sha256 = hash(content);
                const version = { path: `pages/${key}-${sha256}.json`, sha256, bytes: Buffer.byteLength(content) };
                await atomic(version.path, content, true);
                const previous = pages.get(key), changed = !!previous && !previous.versions.some(item => item.sha256 === sha256);
                if (!previous) pages.set(key, { key, ...scope, versions: [version] });
                else if (changed) previous.versions.push(version);
                await atomic("pages-index.json", json(wrapped([...pages.values()])));
                return { ...version, key, changed };
            }); },
            saveBytes(bytes: Uint8Array, meta: { id: string; sha256: string; size: number }) { return queued(async () => {
                if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024 || meta.size !== bytes.byteLength || meta.sha256 !== hash(bytes) || !/^[a-f0-9]{64}$/.test(meta.id)) throw new ChannelOutputError("bytes");
                const receipt = { path: `bytes/${meta.sha256}.bin`, sha256: meta.sha256, size: meta.size };
                await atomic(receipt.path, bytes, true);
                return receipt;
            }); },
            verifyBytes(receipt: ChannelBytesReceipt) { return queued(async () => {
                await assertLock();
                if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.path !== `bytes/${receipt.sha256}.bin` || !Number.isSafeInteger(receipt.size) || receipt.size < 1 || receipt.size > 20 * 1024 * 1024) return false;
                try {
                    await subdirectory("bytes");
                    const target = path.join(root, ...receipt.path.split("/")), info = await exists(target);
                    if (!info?.isFile() || info.isSymbolicLink() || info.size !== receipt.size) return false;
                    const digest = await fileDigest(target);
                    return digest.sha256 === receipt.sha256 && digest.size === receipt.size;
                } catch { return false; }
            }); },
            publish(result: { status: Status; bundle: unknown; checkpoint: unknown; counts: unknown; limitations: readonly string[] }, plan?: ChannelChunkPlan, files?: { status: string; manifest: unknown; counts: unknown; limitations: readonly string[] }, issue?: { code: string; detail?: unknown }) { return queued(async () => {
                status(result.status);
                const state = validateCheckpoint(result.checkpoint, identity);
                validatePageCoverage(state);
                if (state.status !== result.status || json(state.bundle) !== json(result.bundle) || (plan && result.status !== "complete")) throw new ChannelOutputError("checkpoint");
                if (plan && (plan.manifest.namespace !== identity.namespace || plan.manifest.workspaceId !== identity.workspaceId)) throw new ChannelOutputError("identity");
                await atomic("checkpoint.json", json(wrapped(result.checkpoint)));
                const raw = json(result.bundle), rawSha256 = hash(raw), rawPath = `raw/${rawSha256}.json`;
                await atomic(rawPath, raw, true);
                for (const chunk of plan?.chunks ?? []) {
                    if (chunk.input.content !== json(chunk.bundle) || hash(chunk.input.content) !== chunk.sha256) throw new ChannelOutputError("checkpoint");
                    await atomic(`chunks/${chunk.fileName}`, chunk.input.content, true);
                }
                if (files) await atomic("files.json", json(wrapped(files)));
                const pageEntries = [...pages.values()];
                const noImportData = !!plan && plan.chunks.length === 0;
                const manifest = { formatVersion: 1, identity, stage: "finished", sourceStatus: result.status, importStatus: issue ? "blocked" : noImportData ? "no-import-data" : plan ? "ready" : "source-incomplete", importReady: result.status === "complete" && !!plan && !noImportData && !issue, migrationApplied: false, raw: { path: rawPath, sha256: rawSha256, bytes: Buffer.byteLength(raw) }, pages: { index: "pages-index.json", scopes: pages.size, versions: pageEntries.reduce((sum, entry) => sum + entry.versions.length, 0), changedScopes: pageEntries.filter(entry => entry.versions.length > 1).length }, sourceCounts: result.counts, import: plan?.manifest, chunks: plan?.chunks.map(({ fileName, phase, expectedCounts, primaryCounts, dependencyCounts, rawCounts, normalizedRows, characters, bytes, sha256, warnings }) => ({ path: `chunks/${fileName}`, phase, expectedCounts, primaryCounts, dependencyCounts, rawCounts, normalizedRows, characters, bytes, sha256, warnings })), files: files ? { status: files.status, path: "files.json", counts: files.counts } : { status: "needs_source" }, issue, limitations: [...result.limitations, ...(plan?.manifest.limitations ?? []), ...(noImportData ? ["가져올 정규화 행이 없습니다 (no-import-data). 전체 고객이 없다는 증거는 아닙니다."] : []), ...(files?.limitations ?? ["첨부 파일 원본은 아직 백업하지 않았습니다 (needs_source)."]), ...(pageEntries.some(entry => entry.versions.length > 1) ? ["같은 조회 페이지의 원본 내용이 변경되어 여러 버전을 보존했습니다. 시점 일관성을 검토해주세요."] : []), "CRM 가져오기와 운영 반영·고객 공개는 실행하지 않았습니다."] };
                await atomic("manifest.json", json(manifest));
                return manifest;
            }); },
            fail(code: string) { return queued(async () => {
                await atomic("manifest.json", json({ formatVersion: 1, identity, stage: "failed", importReady: false, migrationApplied: false, issue: { code } }));
            }); },
            close() {
                if (closing) return pending.then(() => {});
                closing = true;
                const operation = pending.then(async () => { await assertLock(); closed = true; await fs.unlink(lockPath); });
                pending = operation.catch(() => {});
                return operation;
            },
        };
    } catch (error) {
        try { const current = await readObject(lockPath); if (current.nonce === nonce) await fs.unlink(lockPath); } catch {}
        throw error;
    }
}
