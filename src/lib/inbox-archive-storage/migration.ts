import type { SendbClient, SendbImportFileDetail } from "../../../sdk/server";
import { fingerprint } from "@/lib/customer-imports/rules";
import { verifiedArchiveBytes, type ArchiveSource, type ArchiveStore } from "./store";
import { ArchiveMigrationError, type ArchiveMigrationIdentity, type ArchiveMigrationSourceFile, loadArchiveMigrationSource } from "./migration-source";

type Source = Awaited<ReturnType<typeof loadArchiveMigrationSource>>;
export type ArchiveMigrationClient = Pick<SendbClient, "imports" | "importFiles" | "importFile" | "planArchiveImportFile" | "connectArchiveImportFile">;
export type ArchiveStorageBinding = { endpoint: string; bucket: string; region: string };
export type ArchiveMigrationPlan = {
    version: 1; identity: ArchiveMigrationIdentity; storage: ArchiveStorageBinding; sourceSnapshot: Source["snapshot"]; coverage: Source["coverage"];
    limitations: string[]; items: { source: ArchiveMigrationSourceFile; target: SendbImportFileDetail; issues: string[] }[];
    unmatchedTargets: string[]; sha256: string;
};
export function archiveMigrationPlanSha(plan: Omit<ArchiveMigrationPlan, "sha256"> | ArchiveMigrationPlan) {
    const { sha256: _, ...rest } = plan as ArchiveMigrationPlan; void _; return fingerprint(rest);
}
function fail(code: string): never { throw new ArchiveMigrationError(code); }
function targetIssue(identity: ArchiveMigrationIdentity, source: ArchiveMigrationSourceFile, current: SendbImportFileDetail) {
    const { job, file, message } = current;
    if (job.source !== "channel" || job.workspaceId !== identity.workspaceId || job.namespace !== identity.namespace || file.workspaceId !== identity.workspaceId || file.jobId !== job.id) return "target_scope";
    if (job.state !== "completed" || !file.active || !file.metadataValid || message.sourceId !== source.messageSourceId || message.sourceFingerprint !== source.sourceFingerprint || message.kind !== source.kind) return "target_source_changed";
    if (file.sourceKey !== source.sourceKey || file.manifest !== source.descriptorHash || file.fileName !== source.name || file.expectedSize !== source.expectedSize || file.expectedSha256 !== source.expectedSha256 || fingerprint(file.locator) !== fingerprint(source.locator)) return "target_file_changed";
    if (file.state === "fetching" || (file.state === "ready" && !file.attachmentId)) return "target_busy_or_incomplete";
    return undefined;
}
export async function collectArchiveTargets(client: ArchiveMigrationClient, identity: ArchiveMigrationIdentity, signal?: AbortSignal) {
    const jobs = new Set<string>(), files = new Set<string>(), details: SendbImportFileDetail[] = [];
    let before: string | undefined;
    for (let pageNo = 0; ; pageNo++) {
        signal?.throwIfAborted(); if (pageNo > 10000) fail("page_limit");
        const page = await client.imports(identity.workspaceId, before);
        if (!Array.isArray(page.rows) || page.rows.length > 50 || (page.hasMore && !page.rows.length)) fail("invalid_job_page");
        for (const job of page.rows) {
            if (!job.id || jobs.has(job.id)) fail("duplicate_job_page"); jobs.add(job.id); before = job.id;
            if (job.source !== "channel" || job.namespace !== identity.namespace || job.state !== "completed") continue;
            let offset = 0, total: number | undefined;
            for (let n = 0; ; n++) {
                signal?.throwIfAborted(); if (n > 10000) fail("page_limit");
                const result = await client.importFiles(job.id, offset);
                if (result.offset !== offset || !Number.isSafeInteger(result.total) || result.total < 0 || result.rows.length > 100 || (total !== undefined && result.total !== total) || (result.hasMore && !result.rows.length)) fail("invalid_file_page");
                total = result.total;
                for (const file of result.rows) {
                    if (files.has(file.id)) fail("duplicate_file_page"); files.add(file.id);
                    if (file.active) { const detail = await client.importFile(job.id, file.id); if (detail.job.id !== job.id || detail.file.id !== file.id || detail.file.version !== file.version) fail("target_changed_during_review"); details.push(detail); }
                }
                offset += result.rows.length;
                if (result.hasMore !== (offset < total)) fail("invalid_file_page");
                if (!result.hasMore) break;
            }
        }
        if (!page.hasMore) break;
    }
    return details;
}
export function createArchiveMigrationPlan(identity: ArchiveMigrationIdentity, storage: ArchiveStorageBinding, source: Source, targets: SendbImportFileDetail[]): ArchiveMigrationPlan {
    const used = new Set<string>();
    const plan: ArchiveMigrationPlan = { version: 1, identity: structuredClone(identity), storage: structuredClone(storage), sourceSnapshot: source.snapshot, coverage: source.coverage, limitations: source.limitations, items: [], unmatchedTargets: [], sha256: "" };
    for (const file of source.files) {
        const matching = targets.filter(t => t.message.sourceId === file.messageSourceId && t.file.sourceKey === file.sourceKey);
        if (matching.length !== 1) fail(matching.length ? "ambiguous_target" : "target_missing");
        const target = matching[0], issue = targetIssue(identity, file, target); used.add(target.file.id);
        plan.items.push({ source: structuredClone(file), target: structuredClone(target), issues: issue ? [issue] : [] });
    }
    plan.unmatchedTargets = targets.filter(t => !used.has(t.file.id)).map(t => t.file.id);
    plan.sha256 = archiveMigrationPlanSha(plan); return plan;
}
export type ArchiveMigrationCheckpoint = {
    version: 1; planSha256: string;
    entries: { id: string; state: "pending" | "writing" | "object_written" | "connecting" | "verified" | "unknown" | "failed"; objectKey?: string; attachmentId?: string; issue?: string }[];
};
const safeError = (error: unknown) => error instanceof ArchiveMigrationError ? error.code : (error as { status?: number })?.status === 409 ? "target_changed" : [401, 403].includes((error as { status?: number })?.status ?? 0) ? "permission_denied" : "operation_uncertain";
async function verify(body: AsyncIterable<Uint8Array>, source: ArchiveMigrationSourceFile, signal?: AbortSignal) {
    for await (const chunk of verifiedArchiveBytes({ ...source, open: () => body })) { signal?.throwIfAborted(); void chunk; }
}
/** Never refresh a reviewed CAS version or overwrite an existing object with different bytes. */
export async function runArchiveMigration(plan: ArchiveMigrationPlan, options: {
    approvedSha256: string; client: ArchiveMigrationClient; store: () => ArchiveStore;
    openSource: (file: ArchiveMigrationSourceFile) => ArchiveSource;
    readTarget: (attachmentId: string) => Promise<AsyncIterable<Uint8Array>>;
    persist: (state: ArchiveMigrationCheckpoint) => Promise<void>; resume?: unknown; signal?: AbortSignal;
}) {
    if (plan.version !== 1 || archiveMigrationPlanSha(plan) !== plan.sha256 || plan.sha256 !== options.approvedSha256 || plan.unmatchedTargets.length || plan.items.some(i => i.issues.length)) fail("plan_not_approved_or_blocked");
    let checkpoint: ArchiveMigrationCheckpoint = { version: 1, planSha256: plan.sha256, entries: plan.items.map(i => ({ id: i.source.id, state: "pending" })) };
    if (options.resume !== undefined) {
        const prior = options.resume as ArchiveMigrationCheckpoint;
        if (prior.version !== 1 || prior.planSha256 !== plan.sha256 || !Array.isArray(prior.entries) || prior.entries.length !== plan.items.length || prior.entries.some((e, n) => e.id !== plan.items[n].source.id || !["pending", "writing", "object_written", "connecting", "verified", "unknown", "failed"].includes(e.state))) fail("invalid_checkpoint");
        checkpoint = structuredClone(prior);
    }
    let issue: string | undefined;
    await options.persist(checkpoint);
    for (const [index, item] of plan.items.entries()) {
        const entry = checkpoint.entries[index];
        try {
            options.signal?.throwIfAborted();
            const current = await options.client.importFile(item.target.job.id, item.target.file.id);
            const invalid = targetIssue(plan.identity, item.source, current);
            if (invalid || current.job.version !== item.target.job.version || current.job.fingerprint !== item.target.job.fingerprint) fail(invalid ?? "job_changed");
            if (current.file.state === "ready") {
                if (item.target.file.state === "ready" && (current.file.version !== item.target.file.version || current.file.attachmentId !== item.target.file.attachmentId)) fail("ready_target_changed");
                if (item.target.file.state !== "ready" && current.file.version <= item.target.file.version) fail("ready_target_changed");
                if (entry.attachmentId && entry.attachmentId !== current.file.attachmentId) fail("ready_target_changed");
                await verify(await options.readTarget(current.file.attachmentId!), item.source, options.signal);
                entry.state = "verified"; entry.attachmentId = current.file.attachmentId!; delete entry.issue; await options.persist(checkpoint); continue;
            }
            if (entry.state === "verified" || current.file.version !== item.target.file.version || current.file.state !== item.target.file.state) fail("target_changed");
            const upload = await options.client.planArchiveImportFile(current.job.id, current.file.id, current.file.version, item.source);
            const parts = upload.objectKey.split("/");
            if (parts.length !== 6 || parts[0] !== "inbox-archive" || !/^[a-f0-9-]{36}$/.test(parts[1]) || parts.slice(2).join("/") !== `${plan.identity.workspaceId}/${current.file.id}/${current.file.version}/${item.source.sha256}.bin` || upload.size !== item.source.size || upload.sha256 !== item.source.sha256 || upload.fileName !== item.source.name || (entry.objectKey && entry.objectKey !== upload.objectKey)) fail("upload_target_changed");
            entry.objectKey = upload.objectKey;
            const store = options.store();
            let exists = true;
            try { const content = await store.get(upload.objectKey); if (content.size !== item.source.size) fail("object_size_mismatch"); await verify(content.body, item.source, options.signal); }
            catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) exists = false; else throw error; }
            if (!exists) {
                entry.state = "writing"; await options.persist(checkpoint); options.signal?.throwIfAborted();
                try { await store.put(upload.objectKey, options.openSource(item.source)); }
                catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode !== 412) throw error; }
                const content = await store.get(upload.objectKey); if (content.size !== item.source.size) fail("object_size_mismatch"); await verify(content.body, item.source, options.signal);
            }
            entry.state = "object_written"; await options.persist(checkpoint); options.signal?.throwIfAborted();
            entry.state = "connecting"; await options.persist(checkpoint);
            const saved = await options.client.connectArchiveImportFile(current.job.id, current.file.id, current.file.version, item.source);
            if (saved.id !== current.file.id || saved.state !== "ready" || !saved.attachmentId || saved.version <= current.file.version) fail("unexpected_attach_result");
            const fresh = await options.client.importFile(current.job.id, current.file.id);
            if (targetIssue(plan.identity, item.source, fresh) || fresh.file.attachmentId !== saved.attachmentId) fail("attached_target_changed");
            await verify(await options.readTarget(saved.attachmentId), item.source, options.signal);
            entry.state = "verified"; entry.attachmentId = saved.attachmentId; delete entry.issue; await options.persist(checkpoint);
        } catch (error) {
            issue = safeError(error); entry.issue = issue;
            entry.state = ["writing", "object_written", "connecting"].includes(entry.state) ? "unknown" : "failed";
            await options.persist(checkpoint); break;
        }
    }
    const verified = checkpoint.entries.filter(e => e.state === "verified").length;
    return { status: verified === plan.items.length ? "complete" : "incomplete", scope: "reviewed-bundle-attachments", verified, total: plan.items.length, issue, checkpoint, newAttachmentsCreated: null, sourceCollectionComplete: plan.coverage.sourceCollectionComplete };
}
