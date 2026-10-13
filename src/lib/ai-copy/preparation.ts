import { resolveModel } from "../ai/models";
import type {
    CopyConnection,
    CopyJob,
    CopyPurpose,
    CopyVersion,
    GenerationContext,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "./types";
import { targetsFor } from "./rules";
import {
    copyTransaction,
    CopyDeferredError,
    ensureGenerationJob,
    generateStoredCopy,
    type GenerationDeps,
} from "./generation";

export interface CopyPreparationInput {
    orgId: string;
    workspaceId: number;
    purpose: CopyPurpose;
    ruleId: number;
    key: string;
    model?: string;
    legacyContext: GenerationContext;
    approvedContext?: GenerationContext;
    /** 실험 배정 뒤에는 해당 배정의 고정 버전을 전달한다. */
    pinned?: {
        policy: CopyVersion<PolicySnapshot>;
        knowledge: CopyVersion<KnowledgeSnapshot>;
        assignmentId: number;
    };
}
function legacySnapshot(input: CopyPreparationInput): PolicySnapshot {
    const model = resolveModel(input.model);
    return {
        purpose: input.purpose,
        provider: model.provider,
        model: model.id,
        parameters: { maxOutputTokens: 4096, temperature: 1 },
        instructions: "기존 작성 지침과 생성 동작의 계측용 스냅샷",
        requiredMeanings: ["기존 목적 유지"],
        forbiddenPhrases: [],
        maxCharacters: input.purpose === "visit_ack" ? 600 : 100_000,
        validatorVersion: input.purpose === "visit_ack" ? "legacy-ack-v1" : "legacy-initial-v1",
        targets: targetsFor(input.purpose),
    };
}
export async function resolveCopyJob(conn: CopyConnection, orgId: string, key: string) {
    const [job] = await conn<CopyJob[]>`WITH RECURSIVE chain AS (
        SELECT j.*,ARRAY[j.id] AS trail,1 AS depth FROM ai_copy_generation_jobs j WHERE j.org_id=${orgId} AND j.idempotency_key=${key}
        UNION ALL SELECT j.*,c.trail||j.id,c.depth+1 FROM ai_copy_generation_jobs j JOIN chain c ON j.id=c.superseded_by_id
        WHERE j.org_id=${orgId} AND j.workspace_id=c.workspace_id AND j.purpose=c.purpose AND NOT j.id=ANY(c.trail)
    ) SELECT * FROM chain ORDER BY depth DESC LIMIT 1`;
    return job;
}
export async function prepareCopy(
    conn: CopyConnection,
    input: CopyPreparationInput,
    deps: GenerationDeps,
) {
    let policy: CopyVersion<PolicySnapshot> | undefined = input.pinned?.policy;
    let knowledge: CopyVersion<KnowledgeSnapshot> | undefined = input.pinned?.knowledge;
    const existing = await resolveCopyJob(conn, input.orgId, input.key);
    if (!existing && !policy) {
        const [binding] = await conn<
            { policy_version_id: number; knowledge_version_id: number }[]
        >`SELECT policy_version_id,knowledge_version_id FROM ai_copy_bindings
            WHERE org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND purpose=${input.purpose} AND rule_id=${input.ruleId}`;
        if (binding) {
            [policy] = await conn<
                CopyVersion<PolicySnapshot>[]
            >`SELECT * FROM ai_copy_policy_versions WHERE id=${binding.policy_version_id} AND org_id=${input.orgId} AND workspace_id=${input.workspaceId}`;
            [knowledge] = await conn<
                CopyVersion<KnowledgeSnapshot>[]
            >`SELECT * FROM ai_copy_knowledge_versions WHERE id=${binding.knowledge_version_id} AND org_id=${input.orgId} AND workspace_id=${input.workspaceId}`;
            if (!policy || !knowledge)
                throw new CopyDeferredError(
                    new Date(deps.now().getTime() + 3600_000),
                    "승인된 작성 버전 연결 확인 필요",
                    true,
                );
        }
    }
    const job =
        existing ??
        (await ensureGenerationJob(conn, {
            orgId: input.orgId,
            workspaceId: input.workspaceId,
            purpose: input.purpose,
            key: input.key,
            policyVersionId: policy?.id,
            knowledgeVersionId: knowledge?.id,
            assignmentId: input.pinned?.assignmentId,
            policy: policy?.snapshot ?? legacySnapshot(input),
            knowledge: knowledge?.snapshot ?? null,
            context: policy ? (input.approvedContext ?? input.legacyContext) : input.legacyContext,
            approvedContext: input.approvedContext,
            eligibleAt: deps.now(),
        }));
    if (!existing && policy && (policy.state !== "approved" || knowledge?.state !== "approved"))
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='승인된 작성 버전 연결 확인 필요' WHERE id=${job.id}`;
    if (input.pinned)
        await conn`UPDATE email_copy_assignments SET generation_job_id=COALESCE(generation_job_id,${job.id}) WHERE id=${input.pinned.assignmentId} AND org_id=${input.orgId}`;
    const output = await generateStoredCopy(conn, { id: job.id, orgId: input.orgId }, deps);
    return { ...output, jobId: job.id, assignmentId: input.pinned?.assignmentId };
}
/** 전송 요청 전에 한 작업을 한 로그에 연결한다. 다른 파티션의 재시도도 중복 전송을 막는다. */
export async function attachCopyToSend(
    conn: CopyConnection,
    input: { orgId: string; jobId: number; logId: number },
) {
    return copyTransaction(conn, async () => {
        const [job] = await conn<
            {
                state: string;
                send_log_id: number | null;
                superseded_by_id: number | null;
                idempotency_key: string;
                blocked: boolean;
                experiment_hold: boolean;
            }[]
        >`SELECT j.state,j.send_log_id,j.superseded_by_id,j.idempotency_key,
            EXISTS(SELECT 1 FROM ai_copy_policy_versions p WHERE p.id=j.policy_version_id AND p.state='blocked')
            OR EXISTS(SELECT 1 FROM ai_copy_knowledge_versions k WHERE k.id=j.knowledge_version_id AND k.state='blocked') AS blocked,
            EXISTS(SELECT 1 FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id
                WHERE a.id=j.assignment_id AND a.org_id=j.org_id AND (e.state IN('invalidated','data_check') OR e.state IN('paused','closed') AND e.pending_mode='hold')) AS experiment_hold
            FROM ai_copy_generation_jobs j WHERE j.id=${input.jobId} AND j.org_id=${input.orgId} FOR UPDATE OF j`;
        if (job?.superseded_by_id) {
            const latest = await resolveCopyJob(conn, input.orgId, job.idempotency_key);
            if (latest.state === "cancelled")
                throw new CopyDeferredError(new Date(Date.now() + 3600_000), "작업 취소", true);
            throw new CopyDeferredError(
                new Date(Date.now() + (latest.state === "held" ? 3600_000 : 10_000)),
                "새 버전 문구 재준비",
                latest.state === "held",
            );
        }
        if (job?.state === "cancelled")
            throw new CopyDeferredError(new Date(Date.now() + 3600_000), "작업 취소", true);
        if (job?.experiment_hold)
            throw new CopyDeferredError(new Date(Date.now() + 3600_000), "실험 미발송 보류", true);
        if (!job || job.state !== "ready" || job.blocked)
            throw new CopyDeferredError(new Date(Date.now() + 3600_000), "문구 검토 대기", true);
        if (job.send_log_id && job.send_log_id !== input.logId) {
            const [sent] =
                await conn`SELECT id FROM email_send_logs WHERE id=${job.send_log_id} AND org_id=${input.orgId} AND (status IN ('pending','sent','delivered','uncertain') OR status='failed' AND request_id IS NOT NULL AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL))`;
            if (sent) return false;
        }
        const [log] =
            await conn`SELECT id FROM email_send_logs WHERE id=${input.logId} AND org_id=${input.orgId}`;
        if (!log) throw new Error("발송 로그 범위 불일치");
        await conn`UPDATE ai_copy_generation_jobs SET send_log_id=${input.logId},updated_at=now() WHERE id=${input.jobId}`;
        await conn`UPDATE email_copy_assignments a SET send_log_id=${input.logId},actual_sender_id=l.sender_profile_id,actual_sender_email=l.sender_email FROM ai_copy_generation_jobs j,email_send_logs l
            WHERE j.id=${input.jobId} AND j.assignment_id=a.id AND a.org_id=${input.orgId} AND l.id=${input.logId} AND l.org_id=a.org_id`;
        return true;
    });
}
