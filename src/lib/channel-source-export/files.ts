import { createHash } from "node:crypto";
import { fileDescriptors, sourceFileUrl } from "@/lib/customer-import-files/rules";
import { fingerprint } from "@/lib/customer-imports/rules";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { safeContentType } from "@/lib/inbox/file-metadata";
import { CHANNEL_SOURCE_VERSION } from "./http";
import type { ChannelExportOptions } from "@/lib/customer-imports/channel-export";

type SourceStatus = "complete" | "incomplete" | "failed" | "aborted";
type FileIssue = "invalid_metadata" | "missing_source_id" | "missing_key" | "file_too_large" | "size_mismatch" | "hash_mismatch" | "mime_mismatch" | "source_denied" | "source_missing" | "source_throttled" | "source_unavailable" | "source_network" | "source_timeout" | "source_contract_mismatch" | "retry_delay_limit" | "unsupported_url" | "download_failed" | "download_timeout" | "url_expired" | "invalid_bytes" | "total_bytes_limit" | "save_failed" | "receipt_invalid" | "stored_verify_failed" | "operation_aborted";
export type ChannelFileReceipt = { path: string; sha256: string; size: number };
export type ChannelFileManifestRow = {
    id: string;
    sourceKey: string;
    descriptorHash: string;
    kind: "customer" | "reply" | "note";
    visibility: "public" | "private";
    state: "pending" | "saved" | "failed";
    attempts: number;
    receipt?: ChannelFileReceipt;
    contentType?: string;
    issue?: FileIssue;
    warnings?: ("mime_not_verified")[];
};
export type ChannelFileManifest = {
    version: 1;
    source: "channel";
    apiVersion: typeof CHANNEL_SOURCE_VERSION;
    channelId: string;
    sourceFingerprint: string;
    sourceComplete: boolean;
    files: ChannelFileManifestRow[];
    issues: ("source_incomplete" | "source_failed" | "source_aborted" | "invalid_bundle" | "invalid_limits" | "file_limit" | "duplicate_source" | "invalid_resume" | "checkpoint_failed" | "coordinator_failed" | "retry_delay_limit" | "operation_aborted")[];
};
export type ChannelFileBackupLimits = {
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxAttempts?: number;
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
    retryBaseMs?: number;
    maxRetryDelayMs?: number;
};
export type ChannelFileBackupOptions = {
    channelId: string;
    sourceStatus?: SourceStatus;
    request: ChannelExportOptions["request"];
    download: (url: string, options: { signal: AbortSignal; maxBytes: number }) => Promise<Buffer>;
    save: (bytes: Buffer, metadata: { id: string; name: string; sha256: string; size: number; contentType: string }) => Promise<ChannelFileReceipt>;
    verify?: (receipt: ChannelFileReceipt) => Promise<boolean>;
    resume?: unknown;
    checkpoint?: (manifest: ChannelFileManifest) => Promise<void>;
    sleep?: (ms: number, options: { signal: AbortSignal }) => Promise<void>;
    limits?: ChannelFileBackupLimits;
    signal?: AbortSignal;
};
type Descriptor = ReturnType<typeof fileDescriptors>[number];
type Asset = { row: ChannelFileManifestRow; descriptor: Descriptor; chatId: string; mime: string | null; invalid: boolean; sourceIdValid: boolean };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sourceId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200 ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
class Interrupted extends Error { constructor(readonly reason: "aborted" | "timeout") { super(reason); } }
class CheckpointFailed extends Error {}
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, timeout: number, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Interrupted("aborted");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
    let rejectAbort = () => {};
    const stopped = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Interrupted(timedOut ? "timeout" : "aborted"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => run(controller.signal)), stopped]); }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", rejectAbort);
    }
}
function receipt(raw: unknown): ChannelFileReceipt | undefined {
    const value = object(raw);
    if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) ||
        typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_FILE_BYTES ||
        value.path !== `bytes/${value.sha256}.bin`) return undefined;
    return { path: value.path as string, sha256: value.sha256, size: value.size };
}
function limits(input: ChannelFileBackupLimits = {}) {
    const result = { maxFiles: input.maxFiles ?? 5000, maxFileBytes: input.maxFileBytes ?? MAX_FILE_BYTES, maxTotalBytes: input.maxTotalBytes ?? 2 * 1024 ** 3, maxAttempts: input.maxAttempts ?? 3, requestTimeoutMs: input.requestTimeoutMs ?? 15000, operationTimeoutMs: input.operationTimeoutMs ?? 30000, retryBaseMs: input.retryBaseMs ?? 500, maxRetryDelayMs: input.maxRetryDelayMs ?? 5000 };
    for (const [key, value] of Object.entries(result)) if (!Number.isSafeInteger(value) || value < (key === "retryBaseMs" || key === "maxRetryDelayMs" ? 0 : 1)) throw new Error();
    if (result.maxFiles > 100000 || result.maxFileBytes > MAX_FILE_BYTES || result.maxTotalBytes > MAX_FILE_BYTES * 100000 || result.maxAttempts > 10 || result.requestTimeoutMs > 120000 || result.operationTimeoutMs > 120000 || result.maxRetryDelayMs > 60000 || result.retryBaseMs > 60000) throw new Error();
    return result;
}
function mime(value: unknown) {
    if (typeof value !== "string" || !value.includes("/")) return null;
    const type = value.split(";", 1)[0].trim().toLowerCase();
    return type === "image/jpg" ? "image/jpeg" : type === "image/x-png" ? "image/png" : type;
}
function applyResume(raw: unknown, manifest: ChannelFileManifest) {
    const prior = object(raw);
    if (prior.version !== 1 || prior.source !== "channel" || prior.apiVersion !== CHANNEL_SOURCE_VERSION || prior.channelId !== manifest.channelId || prior.sourceFingerprint !== manifest.sourceFingerprint || !Array.isArray(prior.files) || prior.files.length !== manifest.files.length) throw new Error();
    const byId = new Map<string, Record<string, unknown>>();
    for (const entry of prior.files) {
        const row = object(entry);
        if (typeof row.id !== "string" || byId.has(row.id)) throw new Error();
        byId.set(row.id, row);
    }
    for (const row of manifest.files) {
        const old = byId.get(row.id);
        if (!old || old.sourceKey !== row.sourceKey || old.descriptorHash !== row.descriptorHash || old.kind !== row.kind || old.visibility !== row.visibility || !["pending", "saved", "failed"].includes(String(old.state)) || !Number.isSafeInteger(old.attempts) || Number(old.attempts) < 0 || Number(old.attempts) > 1000000) throw new Error();
        const saved = receipt(old.receipt);
        if ((old.receipt !== undefined && !saved) || (old.state === "saved" && !saved)) throw new Error();
        row.attempts = Number(old.attempts);
        if (saved) row.receipt = saved;
        if (["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/octet-stream"].includes(String(old.contentType))) {
            row.contentType = String(old.contentType);
            if (old.contentType === "application/octet-stream") row.warnings = ["mime_not_verified"];
        }
    }
}
function retryDelay(headers: Record<string, string>, attempt: number, config: ReturnType<typeof limits>) {
    const raw = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
    const parsed = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : NaN;
    if (Number.isFinite(parsed) && parsed > config.maxRetryDelayMs) return null;
    return Math.min(config.maxRetryDelayMs, Math.max(0, Number.isFinite(parsed) ? parsed : config.retryBaseMs * 2 ** (attempt - 1)));
}
async function sleep(ms: number, { signal }: { signal: AbortSignal }) {
    if (signal.aborted) throw new Interrupted("aborted");
    await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); reject(new Interrupted("aborted")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
        signal.addEventListener("abort", stop, { once: true });
    });
}

/** Back up source bytes only; it neither imports history nor grants customer access to files. */
export async function backupChannelFiles(bundle: unknown, options: ChannelFileBackupOptions) {
    const source = object(bundle);
    const sourceStatus = options.sourceStatus ?? (source.hasNext === false ? "complete" : "incomplete");
    const manifest: ChannelFileManifest = { version: 1, source: "channel", apiVersion: CHANNEL_SOURCE_VERSION, channelId: options.channelId, sourceFingerprint: "", sourceComplete: source.hasNext === false && sourceStatus === "complete", files: [], issues: [] };
    const counts = { metadataFiles: 0, saved: 0, failed: 0, pending: 0, verifiedFromResume: 0, downloaded: 0, downloadedBytes: 0, savedBytes: 0, sourceRequests: 0 };
    const limitations = new Set<string>(["첨부 바이트 백업과 샌드비 상담으로 파일을 연결하는 단계는 별도입니다."]);
    let config: ReturnType<typeof limits>, consumedBytes = 0, fatal = false, aborted = false, checkpointFailed = false;
    let current: ChannelFileManifestRow | undefined;
    const finish = () => {
        counts.saved = manifest.files.filter(row => row.state === "saved").length;
        counts.failed = manifest.files.filter(row => row.state === "failed").length;
        counts.pending = manifest.files.filter(row => row.state === "pending").length;
        counts.savedBytes = manifest.files.reduce((total, row) => total + (row.state === "saved" ? row.receipt?.size ?? 0 : 0), 0);
        if (!manifest.sourceComplete) limitations.add("원본 수집이 닫히지 않아 모든 파일 백업이 완료되어도 전체 완료로 표시하지 않습니다.");
        if (counts.failed || counts.pending || manifest.issues.length) limitations.add("누락 또는 미검증 파일과 수집 제한은 manifest의 상태·issue를 확인해주세요.");
        if (manifest.files.some(row => row.warnings?.includes("mime_not_verified"))) limitations.add("내용 형식을 판별하지 못한 파일은 원본 바이트를 보관하며 미리보기 형식 검증은 완료되지 않았습니다.");
        const status: SourceStatus = aborted || sourceStatus === "aborted" ? "aborted" : fatal || sourceStatus === "failed" ? "failed" : manifest.sourceComplete && counts.saved === counts.metadataFiles && manifest.issues.length === 0 ? "complete" : "incomplete";
        return { status, manifest, counts, limitations: [...limitations] };
    };
    try { manifest.sourceFingerprint = fingerprint({ version: 1, channelId: options.channelId, bundle }); }
    catch { manifest.issues.push("invalid_bundle"); fatal = true; return finish(); }
    if (!Object.prototype.hasOwnProperty.call(source, "hasNext") || typeof source.hasNext !== "boolean" || !Array.isArray(source.messages) || typeof options.channelId !== "string" || !options.channelId || options.channelId.length > 200 || !["complete", "incomplete", "failed", "aborted"].includes(sourceStatus)) {
        manifest.issues.push("invalid_bundle"); fatal = true; return finish();
    }
    if (!manifest.sourceComplete) manifest.issues.push(sourceStatus === "failed" ? "source_failed" : sourceStatus === "aborted" ? "source_aborted" : "source_incomplete");
    try { config = limits(options.limits); }
    catch { manifest.issues.push("invalid_limits"); fatal = true; return finish(); }
    const checkpoint = async () => {
        if (!options.checkpoint || checkpointFailed) return;
        try { await bounded(() => options.checkpoint!(structuredClone(manifest)), config.operationTimeoutMs); }
        catch { checkpointFailed = true; manifest.issues.push("checkpoint_failed"); throw new CheckpointFailed(); }
    };
    const assets: Asset[] = [];
    try {
        for (const value of source.messages) {
            const message = object(value);
            if (message.files !== undefined && message.files !== null && !Array.isArray(message.files)) throw new Error();
            counts.metadataFiles += Array.isArray(message.files) ? message.files.length : 0;
        }
        if (counts.metadataFiles > config.maxFiles) { manifest.issues.push("file_limit"); fatal = true; await checkpoint(); return finish(); }
        const ids = new Set<string>();
        for (const value of source.messages) {
            const message = object(value), chatId = sourceId(message.chatId), messageId = sourceId(message.id);
            const raw = Array.isArray(message.files) ? message.files : [];
            const safe = raw.map(object);
            const kind = Array.isArray(message.options) && message.options.includes("private") ? "note" : message.personType === "user" ? "customer" : ["manager", "bot"].includes(String(message.personType)) ? "reply" : "note";
            for (const descriptor of fileDescriptors(safe)) {
                const id = fingerprint([chatId, messageId, descriptor.sourceKey]);
                if (ids.has(id)) { manifest.issues.push("duplicate_source"); fatal = true; await checkpoint(); return finish(); }
                ids.add(id);
                const row: ChannelFileManifestRow = { id, sourceKey: descriptor.sourceKey, descriptorHash: descriptor.manifest, kind, visibility: kind === "note" ? "private" : "public", state: "pending", attempts: 0 };
                manifest.files.push(row);
                assets.push({ row, descriptor, chatId, mime: mime(safe[descriptor.index].contentType ?? safe[descriptor.index].content_type ?? safe[descriptor.index].type), invalid: descriptor.invalid || raw[descriptor.index] === null || typeof raw[descriptor.index] !== "object" || Array.isArray(raw[descriptor.index]), sourceIdValid: !!chatId && !!messageId });
            }
        }
    } catch (error) { if (!(error instanceof CheckpointFailed)) manifest.issues.push("invalid_bundle"); fatal = true; await checkpoint().catch(() => {}); return finish(); }
    if (options.resume !== undefined) {
        try { applyResume(options.resume, manifest); }
        catch { manifest.issues.push("invalid_resume"); fatal = true; return finish(); }
    }
    try {
        await checkpoint();
        if (options.signal?.aborted || sourceStatus === "aborted") throw new Interrupted("aborted");
        files: for (const asset of assets) {
            current = asset.row;
            const { row, descriptor } = asset;
            if (options.signal?.aborted) throw new Interrupted("aborted");
            const fail = async (issue: FileIssue) => { row.state = "failed"; row.issue = issue; await checkpoint(); };
            if (descriptor.size !== null && descriptor.size > config.maxFileBytes) { await fail("file_too_large"); continue; }
            if (asset.invalid) { await fail("invalid_metadata"); continue; }
            if (!asset.sourceIdValid) { await fail("missing_source_id"); continue; }
            if (!descriptor.locator.key || !descriptor.locator.key.trim()) { await fail("missing_key"); continue; }
            if (row.receipt && options.verify) {
                let verified = false;
                try { verified = await bounded(() => options.verify!(row.receipt!), config.operationTimeoutMs, options.signal); }
                catch (error) { if (error instanceof Interrupted && error.reason === "aborted") throw error; }
                const mimeMatches = row.contentType && (!asset.mime || asset.mime === "application/octet-stream" || asset.mime === row.contentType || (row.contentType === "application/octet-stream" && !["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(asset.mime)));
                if (verified && mimeMatches && (descriptor.size === null || descriptor.size === row.receipt.size) && (!descriptor.sha || descriptor.sha === row.receipt.sha256) && row.receipt.size <= config.maxFileBytes && consumedBytes + row.receipt.size <= config.maxTotalBytes) {
                    consumedBytes += row.receipt.size;
                    row.state = "saved"; row.issue = undefined;
                    counts.verifiedFromResume++;
                    await checkpoint(); continue;
                }
            }
            row.state = "pending";
            for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
                if (options.signal?.aborted) throw new Interrupted("aborted");
                const remaining = config.maxTotalBytes - consumedBytes;
                if (remaining < 1 || (descriptor.size !== null && descriptor.size > remaining)) { await fail("total_bytes_limit"); break; }
                row.attempts++;
                row.issue = undefined;
                await checkpoint();
                let issue: FileIssue | undefined, retry = false, delay = retryDelay({}, attempt, config), url = "";
                try {
                    counts.sourceRequests++;
                    const response = await bounded(signal => options.request({ method: "GET", path: `/open/user-chats/${encodeURIComponent(asset.chatId)}/messages/file`, query: { key: descriptor.locator.key! }, headers: { "Channel-Version": CHANNEL_SOURCE_VERSION }, timeoutMs: config.requestTimeoutMs, signal }), config.requestTimeoutMs, options.signal);
                    if (response.status === 429 || response.status >= 500) { issue = response.status === 429 ? "source_throttled" : "source_unavailable"; retry = true; delay = retryDelay(response.headers ?? {}, attempt, config); }
                    else if (response.status === 401 || response.status === 403) issue = "source_denied";
                    else if (response.status === 404 || response.status === 410) issue = "source_missing";
                    else if (response.status !== 200) issue = "source_unavailable";
                    else {
                        try { url = sourceFileUrl(String(object(response.body).result ?? "")); }
                        catch { issue = "unsupported_url"; }
                    }
                } catch (error) {
                    if (error instanceof Interrupted && error.reason === "aborted") throw error;
                    const transportCode = object(error).code;
                    issue = error instanceof Interrupted || transportCode === "timeout" ? "source_timeout" : transportCode === "version" || transportCode === "configuration" || transportCode === "request" || transportCode === "redirect" || transportCode === "too_large" || transportCode === "json" ? "source_contract_mismatch" : "source_network";
                    retry = issue !== "source_contract_mismatch";
                }
                let bytes: Buffer | undefined;
                if (!issue) {
                    try { bytes = await bounded(signal => options.download(url, { signal, maxBytes: Math.min(config.maxFileBytes, remaining) }), config.operationTimeoutMs, options.signal); }
                    catch (error) {
                        if (error instanceof Interrupted && error.reason === "aborted") throw error;
                        issue = error instanceof Interrupted ? "download_timeout" : object(error).needsSource === true ? "url_expired" : "download_failed"; retry = true;
                    }
                }
                if (bytes !== undefined) {
                    if (!Buffer.isBuffer(bytes)) issue = "invalid_bytes";
                    else {
                        counts.downloaded++; counts.downloadedBytes += bytes.length; consumedBytes += bytes.length;
                        if (!bytes.length) issue = "invalid_bytes";
                        else if (bytes.length > config.maxFileBytes) issue = "file_too_large";
                        else if (bytes.length > remaining) issue = "total_bytes_limit";
                        else if (descriptor.size !== null && descriptor.size !== bytes.length) issue = "size_mismatch";
                        else if (descriptor.sha && descriptor.sha !== sha(bytes)) issue = "hash_mismatch";
                        else {
                            const detected = safeContentType(bytes);
                            const known = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
                            if (asset.mime && asset.mime !== "application/octet-stream" && detected !== asset.mime && (known.includes(asset.mime) || detected !== "application/octet-stream")) issue = "mime_mismatch";
                            else {
                                row.contentType = detected;
                                row.warnings = detected === "application/octet-stream" ? ["mime_not_verified"] : undefined;
                                const digest = sha(bytes);
                                try {
                                    const saved = receipt(await bounded(() => options.save(bytes!, { id: row.id, name: descriptor.name, sha256: digest, size: bytes!.length, contentType: detected }), config.operationTimeoutMs, options.signal));
                                    if (!saved || saved.sha256 !== digest || saved.size !== bytes.length) issue = "receipt_invalid";
                                    else {
                                        row.receipt = saved;
                                        if (options.verify && !await bounded(() => options.verify!(saved), config.operationTimeoutMs, options.signal)) issue = "stored_verify_failed";
                                        else { row.state = "saved"; row.issue = undefined; await checkpoint(); break; }
                                    }
                                } catch (error) { if (error instanceof Interrupted && error.reason === "aborted") throw error; if (error instanceof CheckpointFailed) throw error; issue = "save_failed"; }
                            }
                        }
                    }
                }
                row.issue = issue ?? "download_failed";
                if (retry && delay === null) {
                    manifest.issues.push("retry_delay_limit");
                    await fail("retry_delay_limit");
                    break files;
                }
                if (retry && attempt < config.maxAttempts) {
                    await checkpoint();
                    try { await bounded(signal => (options.sleep ?? sleep)(delay!, { signal }), Math.max(1, Math.min(config.operationTimeoutMs, delay! + 1000)), options.signal); }
                    catch (error) { if (error instanceof Interrupted && error.reason === "aborted") throw error; await fail(row.issue); break; }
                } else { await fail(row.issue); break; }
            }
        }
    } catch (error) {
        if (error instanceof Interrupted && error.reason === "aborted") { aborted = true; manifest.issues.push("operation_aborted"); if (current?.state === "pending") current.issue = "operation_aborted"; }
        else { fatal = true; if (!(error instanceof CheckpointFailed)) manifest.issues.push("coordinator_failed"); }
    }
    if (options.signal?.aborted && !aborted) { aborted = true; manifest.issues.push("operation_aborted"); }
    try { await checkpoint(); } catch { fatal = true; }
    return finish();
}
