import { createHash } from "node:crypto";
import type { ChannelFileReceipt } from "./files";
import {
    channelTransferPlanSha256, ChannelTransferError, inspectChannelTransferTarget,
    validChannelTransferReceipt,
    type ChannelTransferPlan, type ChannelTransferItem, type ChannelTransferJobSnapshot,
    type ChannelTransferTargetFile,
} from "./transfer-plan";

export type ChannelTransferEntry = {
    id: string;
    state: "pending" | "blocked" | "uploading" | "uploaded" | "already_ready" | "failed" | "unknown";
    issue?: string;
    jobId?: string; fileId?: string; reviewedVersion?: number;
    resultVersion?: number; attachmentId?: string;
    size?: number; sha256?: string;
};
export type ChannelTransferCheckpoint = {
    version: 1; planSha256: string; entries: ChannelTransferEntry[];
};
export type ChannelTransferRunOptions = {
    approvedPlanSha256: string;
    refreshJob: (jobId: string) => Promise<ChannelTransferJobSnapshot>;
    readBytes: (receipt: ChannelFileReceipt) => Promise<Buffer>;
    /** Existing protected download endpoint; required even for ready/response-loss recovery. */
    readTargetBytes: (file: ChannelTransferTargetFile) => Promise<Buffer>;
    upload: (item: ChannelTransferItem, bytes: Buffer) => Promise<ChannelTransferTargetFile>;
    checkpoint?: (state: ChannelTransferCheckpoint) => Promise<void>;
    resume?: unknown;
    signal?: AbortSignal;
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const failureCode = (error: unknown) => {
    const value = error as { status?: number; statusCode?: number };
    const status = value?.status ?? value?.statusCode;
    return status === 401 || status === 403 ? "permission_denied" : status === 409 ? "target_changed" : "operation_uncertain";
};
function restore(plan: ChannelTransferPlan, raw: unknown): ChannelTransferCheckpoint {
    const state: ChannelTransferCheckpoint = { version: 1, planSha256: plan.sha256,
        entries: plan.items.map(item => ({ id: item.id, state: item.action === "blocked" ? "blocked" : "pending",
            ...(item.target ? { jobId: item.target.jobId, fileId: item.target.fileId, reviewedVersion: item.target.version } : {}),
            ...(item.action === "blocked" ? { issue: item.issues.join(",") } : {}),
        })) };
    if (raw === undefined) return state;
    const prior = structuredClone(raw) as ChannelTransferCheckpoint;
    if (prior?.version !== 1 || prior.planSha256 !== plan.sha256 || !Array.isArray(prior.entries) || prior.entries.length !== state.entries.length) throw new ChannelTransferError("invalid_resume");
    for (let index = 0; index < state.entries.length; index++) {
        const expected = state.entries[index], entry = prior.entries[index];
        if (!entry || entry.id !== expected.id || entry.jobId !== expected.jobId || entry.fileId !== expected.fileId || entry.reviewedVersion !== expected.reviewedVersion || !["pending", "blocked", "uploading", "uploaded", "already_ready", "failed", "unknown"].includes(entry.state) || (expected.state === "blocked") !== (entry.state === "blocked")) throw new ChannelTransferError("invalid_resume");
        if (entry.state === "uploaded" && (entry.sha256 !== plan.items[index].source.receipt?.sha256 || entry.size !== plan.items[index].source.receipt?.size || !entry.attachmentId || !Number.isSafeInteger(entry.resultVersion))) throw new ChannelTransferError("invalid_resume");
    }
    return prior;
}

/** Executes only the exact approved plan. All API and file I/O are supplied by the caller. */
export async function runChannelFileTransfer(input: ChannelTransferPlan, options: ChannelTransferRunOptions) {
    const plan = structuredClone(input);
    if (plan.version !== 1 || plan.sha256 !== options.approvedPlanSha256 || channelTransferPlanSha256(plan) !== options.approvedPlanSha256 || new Set(plan.items.map(item => item.id)).size !== plan.items.length) throw new ChannelTransferError("plan_not_approved");
    if (typeof options.readTargetBytes !== "function") throw new ChannelTransferError("target_verifier_required");
    const checkpoint = restore(plan, options.resume);
    let stopped: "aborted" | "failed" | undefined, stopIssue: string | undefined;
    let uploads = 0, uploadedBytes = 0;
    const verifyTarget = async (file: ChannelTransferTargetFile, receipt: ChannelFileReceipt) => {
        const bytes = await options.readTargetBytes(structuredClone(file));
        if (!Buffer.isBuffer(bytes) || bytes.length !== receipt.size || sha(bytes) !== receipt.sha256) throw new ChannelTransferError("target_bytes_mismatch");
    };
    const persist = async () => {
        if (!options.checkpoint) return;
        try { await options.checkpoint(structuredClone(checkpoint)); }
        catch { throw new ChannelTransferError("checkpoint_failed"); }
    };
    try {
        await persist();
        for (let index = 0; index < plan.items.length; index++) {
            const item = plan.items[index], entry = checkpoint.entries[index];
            if (options.signal?.aborted) { stopped = "aborted"; stopIssue = "operation_aborted"; break; }
            if (item.action === "blocked") continue;
            if (!item.target || !validChannelTransferReceipt(item.source.receipt)) throw new ChannelTransferError("invalid_plan_item");
            let snapshot: ChannelTransferJobSnapshot;
            try { snapshot = await options.refreshJob(item.target.jobId); }
            catch (error) { entry.state = "failed"; entry.issue = failureCode(error); stopped = "failed"; stopIssue = entry.issue; await persist(); break; }
            if (options.signal?.aborted) { stopped = "aborted"; stopIssue = "operation_aborted"; break; }
            const checked = inspectChannelTransferTarget(plan, item, snapshot);
            if (checked.issue || !checked.file) { entry.state = "failed"; entry.issue = checked.issue ?? "invalid_target"; stopped = "failed"; stopIssue = entry.issue; await persist(); break; }
            if (checked.ready) {
                try { await verifyTarget(checked.file, item.source.receipt); }
                catch (error) {
                    entry.state = "failed";
                    entry.issue = error instanceof ChannelTransferError ? error.code : failureCode(error);
                    stopped = "failed"; stopIssue = entry.issue; await persist(); break;
                }
                const priorUpload = entry.state === "uploaded";
                entry.state = priorUpload ? "uploaded" : "already_ready";
                entry.resultVersion = checked.file.version;
                entry.attachmentId = checked.file.attachmentId!;
                entry.sha256 = item.source.receipt.sha256;
                entry.size = item.source.receipt.size;
                delete entry.issue;
                await persist(); continue;
            }
            if (entry.state === "uploaded" || entry.state === "already_ready") {
                entry.state = "failed"; entry.issue = "completed_target_changed"; stopped = "failed"; stopIssue = entry.issue; await persist(); break;
            }
            let bytes: Buffer;
            try {
                bytes = await options.readBytes(structuredClone(item.source.receipt));
                if (!Buffer.isBuffer(bytes) || bytes.length !== item.source.receipt.size || sha(bytes) !== item.source.receipt.sha256) throw new ChannelTransferError("bytes_mismatch");
                bytes = Buffer.from(bytes);
            } catch {
                entry.state = "failed"; entry.issue = "bytes_missing_or_changed"; await persist(); continue;
            }
            if (options.signal?.aborted) { stopped = "aborted"; stopIssue = "operation_aborted"; break; }
            entry.state = "uploading"; delete entry.issue;
            await persist(); // A failed durable write must not be followed by an upload.
            if (options.signal?.aborted) { entry.state = "pending"; stopped = "aborted"; stopIssue = "operation_aborted"; await persist(); break; }
            let returned: ChannelTransferTargetFile;
            try {
                // The adapter must forward the reviewed id/version/name, not refresh them.
                returned = await options.upload(structuredClone(item), bytes);
                const fresh = { ...snapshot, files: snapshot.files.map(file => file.id === item.target!.fileId ? returned : file) };
                const result = inspectChannelTransferTarget(plan, item, fresh);
                if (result.issue || !result.ready || !result.file || returned.version <= item.target.version) throw new ChannelTransferError("unexpected_upload_result");
                await verifyTarget(returned, item.source.receipt);
                entry.state = "uploaded";
                entry.resultVersion = returned.version;
                entry.attachmentId = returned.attachmentId!;
                entry.sha256 = item.source.receipt.sha256;
                entry.size = bytes.length;
                uploads++; uploadedBytes += bytes.length;
            } catch (error) {
                // A timeout/response loss can follow a successful write. Do not retry here.
                entry.state = "unknown";
                entry.issue = error instanceof ChannelTransferError ? error.code : failureCode(error);
                stopped = "failed"; stopIssue = entry.issue;
                await persist(); break;
            }
            await persist();
        }
    } catch (error) {
        stopped = "failed";
        stopIssue = error instanceof ChannelTransferError ? error.code : "coordinator_failed";
    }
    const counts = {
        planned: plan.items.length,
        uploaded: checkpoint.entries.filter(entry => entry.state === "uploaded").length,
        alreadyReady: checkpoint.entries.filter(entry => entry.state === "already_ready").length,
        blocked: checkpoint.entries.filter(entry => entry.state === "blocked").length,
        failed: checkpoint.entries.filter(entry => entry.state === "failed").length,
        uncertain: checkpoint.entries.filter(entry => entry.state === "unknown" || entry.state === "uploading").length,
        pending: checkpoint.entries.filter(entry => entry.state === "pending").length,
        unmatchedTargets: plan.unmatchedTargets.length,
        uploadedThisRun: uploads, uploadedBytesThisRun: uploadedBytes,
        confirmedUploadedBytes: checkpoint.entries.reduce((total, entry) => total + (entry.state === "uploaded" ? entry.size ?? 0 : 0), 0),
        targetVerified: checkpoint.entries.filter(entry => entry.state === "uploaded" || entry.state === "already_ready").length,
        verifiedTargetBytes: checkpoint.entries.reduce((total, entry) => total + (entry.state === "uploaded" || entry.state === "already_ready" ? entry.size ?? 0 : 0), 0),
        newAttachmentsCreated: null,
    };
    const complete = !plan.issues.length && !counts.unmatchedTargets && counts.uploaded + counts.alreadyReady === counts.planned;
    return { status: stopped ?? (complete ? "complete" : "incomplete") as "complete" | "incomplete" | "aborted" | "failed",
        checkpoint, counts, issue: stopIssue,
        limitations: [...plan.limitations, "uploaded는 POST 응답 후 보호 다운로드 내용이 확인된 수입니다. 경쟁 요청이 먼저 저장했을 수 있어 새 첨부 생성 수는 알 수 없습니다.", "검토 후 대상 버전/관계가 바뀌면 자동으로 버전을 올려 실행하지 않습니다. 재조회 후 새 계획을 검토해야 합니다."] };
}
