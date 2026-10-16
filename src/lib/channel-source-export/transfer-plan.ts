import { fileDescriptors } from "@/lib/customer-import-files/rules";
import { fingerprint } from "@/lib/customer-imports/rules";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import type { ChannelFileManifest, ChannelFileReceipt } from "./files";
import { CHANNEL_SOURCE_VERSION } from "./http";

export type ChannelTransferIdentity = {
    workspaceId: number; source: "channel"; namespace: string; channelId: string;
};
export type ChannelTransferTargetBinding = {
    mode: "offline-fixture" | "online-api" | "test-client";
    origin: string;
};
/** Fields returned by importFiles, including registry fields absent from the SDK's older type. */
export type ChannelTransferTargetFile = {
    id: string; jobId: string; workspaceId: number; messageId: number;
    sourceKey: string; manifest: string; fileName: string;
    state: "pending" | "fetching" | "ready" | "failed" | "needs_source";
    active: boolean; metadataValid: boolean; version: number;
    expectedSize: number | null; expectedSha256: string | null;
    attachmentId: string | null; interrupted: boolean;
    locator: { originalId: string; key: string | null; index: number; conversationId: string; messageSourceId: string };
};
export type ChannelTransferJobSnapshot = {
    job: {
        id: string; workspaceId: number; source: string; namespace: string;
        state: string; version: number; fingerprint: string;
        rows: { index: number; kind: string; sourceId: string; data: Record<string, unknown>; errors: string[] }[];
        results: { position: number; targetId: string }[];
    };
    files: ChannelTransferTargetFile[];
    rowsComplete: true;
    filesComplete: true;
};
export type ChannelTransferSource = {
    chatId: string; messageId: string; messageSourceId: string;
    sourceKey: string; descriptorHash: string; name: string;
    kind: "customer" | "reply" | "note"; visibility: "public" | "private";
    locator: { originalId: string; key: string | null; index: number };
    expectedSize: number | null; expectedSha256: string | null;
    receipt?: ChannelFileReceipt;
};
export type ChannelTransferItem = {
    id: string;
    action: "upload" | "already_ready" | "blocked";
    issues: string[];
    source: ChannelTransferSource;
    target?: {
        jobId: string; fileId: string; version: number; messageId: number;
        jobVersion: number; jobFingerprint: string;
        snapshot: ChannelTransferTargetFile;
    };
};
export type ChannelTransferPlan = {
    version: 1;
    identity: ChannelTransferIdentity;
    sourceFingerprint: string;
    sourceSnapshot: { path: string; sha256: string; size: number }[];
    targetBinding?: ChannelTransferTargetBinding;
    items: ChannelTransferItem[];
    unmatchedTargets: { jobId: string; fileId: string; issue: string }[];
    issues: string[];
    limitations: string[];
    sha256: string;
};
export class ChannelTransferError extends Error {
    constructor(readonly code: string) { super(`Channel file transfer: ${code}`); this.name = "ChannelTransferError"; }
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sourceId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200 ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validChannelTransferReceipt(value: unknown): value is ChannelFileReceipt {
    const row = object(value);
    return hash(row.sha256) && positive(row.size) && Number(row.size) <= MAX_FILE_BYTES && row.path === `bytes/${row.sha256}.bin`;
}
export function channelTransferPlanSha256(plan: Omit<ChannelTransferPlan, "sha256"> | ChannelTransferPlan) {
    const { sha256: _, ...payload } = plan as ChannelTransferPlan;
    void _;
    return fingerprint(payload);
}
function identityValid(identity: ChannelTransferIdentity) {
    return positive(identity.workspaceId) && identity.source === "channel" &&
        typeof identity.namespace === "string" && /^[\p{L}\p{N} _.-]{1,80}$/u.test(identity.namespace) && identity.namespace.trim() === identity.namespace &&
        typeof identity.channelId === "string" && !!identity.channelId && identity.channelId.length <= 200;
}
function bindingValid(binding: ChannelTransferTargetBinding) {
    if (!binding || typeof binding.origin !== "string" || !binding.origin || binding.origin.length > 500 || /[\x00-\x20\x7f]/.test(binding.origin)) return false;
    if (binding.mode === "offline-fixture") return binding.origin === "offline-contract";
    if (binding.mode === "test-client") return true;
    if (binding.mode !== "online-api") return false;
    try { const url = new URL(binding.origin); return ["https:", "http:"].includes(url.protocol) && url.origin === binding.origin; }
    catch { return false; }
}
function scopeMatches(identity: ChannelTransferIdentity, snapshot: ChannelTransferJobSnapshot) {
    return snapshot.job.workspaceId === identity.workspaceId && snapshot.job.source === identity.source && snapshot.job.namespace === identity.namespace;
}
function fileInvariant(file: ChannelTransferTargetFile) {
    return { id: file.id, jobId: file.jobId, workspaceId: file.workspaceId, messageId: file.messageId,
        sourceKey: file.sourceKey, manifest: file.manifest, fileName: file.fileName,
        active: file.active, metadataValid: file.metadataValid, expectedSize: file.expectedSize,
        expectedSha256: file.expectedSha256, locator: file.locator };
}
function targetIssue(source: ChannelTransferSource, file: ChannelTransferTargetFile, snapshot: ChannelTransferJobSnapshot, identity: ChannelTransferIdentity) {
    if (!scopeMatches(identity, snapshot) || file.workspaceId !== identity.workspaceId || file.jobId !== snapshot.job.id) return "target_scope_mismatch";
    if (snapshot.rowsComplete !== true || snapshot.filesComplete !== true) return "target_snapshot_incomplete";
    if (snapshot.job.state !== "completed") return "import_job_incomplete";
    if (!positive(snapshot.job.version) || !hash(snapshot.job.fingerprint) || !positive(file.version) || !positive(file.messageId) || typeof file.id !== "string" || !file.id) return "invalid_target";
    if (!file.active) return "previous_source";
    if (!file.metadataValid) return "invalid_target_metadata";
    if (!["pending", "fetching", "ready", "failed", "needs_source"].includes(file.state)) return "invalid_target_state";
    const wantedLocator = { ...source.locator, conversationId: source.chatId, messageSourceId: source.messageSourceId };
    if (fingerprint(file.locator) !== fingerprint(wantedLocator) || file.sourceKey !== source.sourceKey || file.manifest !== source.descriptorHash || file.fileName !== source.name || file.expectedSize !== source.expectedSize || file.expectedSha256 !== source.expectedSha256) return "target_metadata_mismatch";
    const rows = snapshot.job.rows.filter(row => row.kind === "messages" && row.sourceId === source.messageSourceId);
    if (rows.length !== 1) return rows.length ? "ambiguous_message" : "message_missing";
    const row = rows[0], results = snapshot.job.results.filter(result => result.position === row.index);
    if (row.errors.length || results.length !== 1 || results[0].targetId !== String(file.messageId)) return "message_relation_mismatch";
    if (row.data.conversationId !== source.chatId || row.data.messageKind !== source.kind) return "message_visibility_mismatch";
    const rawFiles = Array.isArray(row.data.files) ? row.data.files : [];
    if (rawFiles.some(value => value === null || typeof value !== "object" || Array.isArray(value))) return "invalid_target_metadata";
    const descriptor = fileDescriptors(rawFiles)[source.locator.index];
    if (!descriptor || descriptor.invalid || descriptor.sourceKey !== source.sourceKey || descriptor.manifest !== source.descriptorHash || fingerprint(descriptor.locator) !== fingerprint(source.locator)) return "target_metadata_mismatch";
    if (file.state === "ready" && !file.attachmentId) return "invalid_ready_target";
    if (file.state === "fetching") return "target_fetching";
    return undefined;
}

/** Re-check the reviewed relationship and CAS state using a fresh, fully paged API snapshot. */
export function inspectChannelTransferTarget(plan: ChannelTransferPlan, item: ChannelTransferItem, snapshot: ChannelTransferJobSnapshot) {
    const target = item.target;
    if (!target || snapshot.job.id !== target.jobId) return { issue: "target_missing" };
    if (snapshot.job.version !== target.jobVersion || snapshot.job.fingerprint !== target.jobFingerprint) return { issue: "import_job_changed" };
    const matches = snapshot.files.filter(file => file.id === target.fileId);
    if (matches.length !== 1) return { issue: matches.length ? "ambiguous_target" : "target_missing" };
    const file = matches[0];
    const issue = targetIssue(item.source, file, snapshot, plan.identity);
    if (issue) return { issue };
    if (fingerprint(fileInvariant(file)) !== fingerprint(fileInvariant(target.snapshot))) return { issue: "target_changed" };
    // A lost successful response is reconciled by observing ready, never by resending.
    if (file.state === "ready") {
        if (target.snapshot.state === "ready" && (file.version !== target.version || file.attachmentId !== target.snapshot.attachmentId)) return { issue: "target_changed" };
        if (target.snapshot.state !== "ready" && file.version <= target.version) return { issue: "target_changed" };
        return { file, ready: true };
    }
    if (item.action === "already_ready" || file.version !== target.version || file.state !== target.snapshot.state) return { issue: "target_changed" };
    return { file, ready: false };
}

/** Pure matching only. No registry preparation, history import, I/O, or uploads. */
export function createChannelTransferPlan(input: {
    identity: ChannelTransferIdentity; bundle: unknown; manifest: ChannelFileManifest; jobs: ChannelTransferJobSnapshot[];
    localIssues?: { id: string; code: string }[];
    sourceSnapshot?: { path: string; sha256: string; size: number }[];
    targetBinding?: ChannelTransferTargetBinding;
}): ChannelTransferPlan {
    const { identity, bundle, manifest, jobs, localIssues = [], sourceSnapshot = [], targetBinding } = structuredClone(input);
    if (!identityValid(identity) || !Array.isArray(jobs)) throw new ChannelTransferError("invalid_input");
    if (targetBinding !== undefined && !bindingValid(targetBinding)) throw new ChannelTransferError("invalid_target_binding");
    if (!Array.isArray(sourceSnapshot) || sourceSnapshot.some(row => typeof row.path !== "string" || !hash(row.sha256) || !positive(row.size))) throw new ChannelTransferError("invalid_source_snapshot");
    const plan: ChannelTransferPlan = { version: 1, identity, sourceFingerprint: fingerprint({ version: 1, channelId: identity.channelId, bundle }), sourceSnapshot, ...(targetBinding ? { targetBinding } : {}), items: [], unmatchedTargets: [], issues: [], sha256: "", limitations: [
        "완료는 선택한 원본과 검토 대상 파일의 보충 범위에만 해당합니다. 전체 계정 이전이나 원본 완전성을 증명하지 않습니다.",
        "ready 대상은 덮어쓰지 않고 보호 다운로드로 원본 receipt와 대조합니다. 전송 후 내용이 같아도 우리 요청이 새 첨부 행을 만들었다는 증거는 아닙니다.",
    ] };
    const raw = object(bundle);
    if (raw.hasNext !== false || raw.next || raw.nextCursor || !Array.isArray(raw.messages)) plan.issues.push("source_incomplete");
    if (manifest?.version !== 1 || manifest.source !== "channel" || manifest.apiVersion !== CHANNEL_SOURCE_VERSION || manifest.channelId !== identity.channelId || manifest.sourceFingerprint !== plan.sourceFingerprint || !Array.isArray(manifest.files)) throw new ChannelTransferError("manifest_mismatch");
    if (!manifest.sourceComplete || manifest.issues.length) plan.issues.push("backup_incomplete");
    const jobIds = new Set<string>();
    for (const snapshot of jobs) {
        if (!snapshot?.job || !Array.isArray(snapshot.job.rows) || !Array.isArray(snapshot.job.results) || !Array.isArray(snapshot.files)) throw new ChannelTransferError("invalid_snapshot");
        if (jobIds.has(snapshot.job.id)) plan.issues.push("duplicate_job");
        jobIds.add(snapshot.job.id);
        if (!scopeMatches(identity, snapshot)) plan.issues.push("target_scope_mismatch");
        if (snapshot.rowsComplete !== true || snapshot.filesComplete !== true) plan.issues.push("target_snapshot_incomplete");
    }
    const manifestRows = new Map<string, typeof manifest.files>();
    for (const row of manifest.files) manifestRows.set(row.id, [...manifestRows.get(row.id) ?? [], row]);
    const sourceIds = new Set<string>(), matchedFiles = new Set<string>();
    for (const value of Array.isArray(raw.messages) ? raw.messages : []) {
        const message = object(value), chatId = sourceId(message.chatId), messageId = sourceId(message.id);
        if (message.files !== undefined && message.files !== null && !Array.isArray(message.files)) { plan.issues.push("invalid_source_files"); continue; }
        const rawFiles = Array.isArray(message.files) ? message.files : [];
        const kind = Array.isArray(message.options) && message.options.includes("private") ? "note" : message.personType === "user" ? "customer" : ["manager", "bot"].includes(String(message.personType)) ? "reply" : "note";
        for (const descriptor of fileDescriptors(rawFiles.map(object))) {
            const id = fingerprint([chatId, messageId, descriptor.sourceKey]);
            const source: ChannelTransferSource = { chatId, messageId, messageSourceId: `${chatId}/${messageId}`, sourceKey: descriptor.sourceKey, descriptorHash: descriptor.manifest, name: descriptor.name, kind, visibility: kind === "note" ? "private" : "public", locator: descriptor.locator, expectedSize: descriptor.size, expectedSha256: descriptor.sha };
            const item: ChannelTransferItem = { id, action: "blocked", issues: [], source };
            item.issues.push(...localIssues.filter(issue => issue.id === id).map(issue => issue.code));
            plan.items.push(item);
            if (sourceIds.has(id)) { item.issues.push("duplicate_source"); plan.issues.push("duplicate_source"); }
            sourceIds.add(id);
            if (!chatId || !messageId) item.issues.push("missing_source_id");
            if (descriptor.invalid || !rawFiles[descriptor.index] || typeof rawFiles[descriptor.index] !== "object" || Array.isArray(rawFiles[descriptor.index])) item.issues.push("invalid_source_metadata");
            const savedRows = manifestRows.get(id) ?? [];
            if (savedRows.length !== 1) item.issues.push(savedRows.length ? "duplicate_manifest_row" : "receipt_missing");
            else {
                const saved = savedRows[0];
                if (saved.sourceKey !== source.sourceKey || saved.descriptorHash !== source.descriptorHash || saved.kind !== kind || saved.visibility !== source.visibility) item.issues.push("manifest_row_mismatch");
                if (saved.state !== "saved" || !validChannelTransferReceipt(saved.receipt)) item.issues.push("receipt_unverified");
                else {
                    source.receipt = saved.receipt;
                    if ((descriptor.size !== null && descriptor.size !== saved.receipt.size) || (descriptor.sha && descriptor.sha !== saved.receipt.sha256)) item.issues.push("receipt_metadata_mismatch");
                }
            }
            const candidates = jobs.flatMap(snapshot => snapshot.files.filter(file => file.locator?.messageSourceId === source.messageSourceId && file.sourceKey === source.sourceKey).map(file => ({ snapshot, file })));
            const active = candidates.filter(({ file }) => file.active);
            if (active.length !== 1) item.issues.push(active.length ? "ambiguous_target" : candidates.length ? "previous_source" : "target_missing");
            else {
                const { snapshot, file } = active[0];
                matchedFiles.add(`${snapshot.job.id}/${file.id}`);
                item.target = { jobId: snapshot.job.id, fileId: file.id, version: file.version, messageId: file.messageId, jobVersion: snapshot.job.version, jobFingerprint: snapshot.job.fingerprint, snapshot: file };
                const issue = targetIssue(source, file, snapshot, identity);
                if (issue) item.issues.push(issue);
                if (!item.issues.length) item.action = file.state === "ready" ? "already_ready" : "upload";
            }
        }
    }
    for (const row of manifest.files) if (!sourceIds.has(row.id)) plan.issues.push("manifest_source_missing");
    if (localIssues.some(issue => !sourceIds.has(issue.id))) plan.issues.push("local_issue_source_missing");
    for (const snapshot of jobs) for (const file of snapshot.files) {
        if (file.active && !matchedFiles.has(`${snapshot.job.id}/${file.id}`)) plan.unmatchedTargets.push({ jobId: snapshot.job.id, fileId: file.id, issue: "unmatched_target" });
    }
    plan.issues = [...new Set(plan.issues)];
    // Unknown coverage or identity blocks the whole plan; individual bad matches remain reviewable.
    if (plan.issues.length) for (const item of plan.items) { item.action = "blocked"; item.issues.push(...plan.issues); }
    plan.sha256 = channelTransferPlanSha256(plan);
    return plan;
}
