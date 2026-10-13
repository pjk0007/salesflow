import type {
    CopyConnection,
    CopyJob,
    CopyVersion,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "./types";
import { copyTransaction, ensureGenerationJob } from "./generation";
import { CopyActionError } from "./errors";
import { resolveCopyJob } from "./preparation";
export async function cancelCopyJob(conn: CopyConnection, input: { orgId: string; id: number }) {
    return copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824304,hashtext(${input.orgId}))`;
        const chain = await conn<CopyJob[]>`WITH RECURSIVE chain AS (
            SELECT j.*,ARRAY[j.id] AS trail FROM ai_copy_generation_jobs j WHERE j.id=${input.id} AND j.org_id=${input.orgId}
            UNION ALL SELECT j.*,c.trail||j.id FROM ai_copy_generation_jobs j JOIN chain c ON j.id=c.superseded_by_id WHERE j.org_id=${input.orgId} AND NOT j.id=ANY(c.trail)
        ) SELECT * FROM chain`;
        if (!chain.length) throw new CopyActionError("작업을 찾을 수 없습니다.");
        for (const job of chain)
            if (job.send_log_id) {
                const [started] =
                    await conn`SELECT id FROM email_send_logs WHERE id=${job.send_log_id} AND org_id=${input.orgId}
                AND (status IN('pending','sent','delivered','uncertain') OR status='failed' AND request_id IS NOT NULL AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL))`;
                if (started) throw new CopyActionError("발송이 시작된 작업은 취소할 수 없습니다.");
            }
        for (const job of chain)
            await conn`UPDATE ai_copy_generation_jobs SET state='cancelled',reason='관리자 취소',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND org_id=${input.orgId}`;
        return { state: "cancelled", cancelledJobs: chain.length };
    });
}

async function rootJob(conn: CopyConnection, orgId: string, id: number) {
    const [root] = await conn<CopyJob[]>`WITH RECURSIVE parents AS (
        SELECT j.*,ARRAY[j.id] AS trail,1 AS depth FROM ai_copy_generation_jobs j WHERE j.org_id=${orgId} AND j.id=${id}
        UNION ALL SELECT j.*,c.trail||j.id,c.depth+1 FROM ai_copy_generation_jobs j JOIN parents c ON j.superseded_by_id=c.id
        WHERE j.org_id=${orgId} AND NOT j.id=ANY(c.trail)
    ) SELECT * FROM parents ORDER BY depth DESC LIMIT 1`;
    return root;
}
export async function requestCopyReplacement(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId: string;
        id: number;
        requestId: string;
        policyVersionId: number;
        knowledgeVersionId: number;
        now: Date;
    },
) {
    return copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824304,hashtext(${input.orgId}))`;
        const key = `replacement:${input.id}:${input.requestId}`;
        const [requested] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE org_id=${input.orgId} AND idempotency_key=${key}`;
        if (requested) {
            if (
                requested.policy_version_id !== input.policyVersionId ||
                requested.knowledge_version_id !== input.knowledgeVersionId
            )
                throw new CopyActionError("같은 재작성 요청의 버전을 바꿀 수 없습니다.");
            return requested;
        }
        const [original] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!original) throw new CopyActionError("재작성할 작업을 찾을 수 없습니다.");
        const latest = await resolveCopyJob(conn, input.orgId, original.idempotency_key);
        const [old] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE id=${latest.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (old.assignment_id || ["evaluation", "benchmark"].includes(old.origin))
            throw new CopyActionError(
                "실험과 평가의 고정 버전은 재작성으로 바꿀 수 없습니다. 문제 실험을 무효화하고 새 버전으로 시작해 주세요.",
            );
        if (!["held", "ready", "cancelled"].includes(old.state))
            throw new CopyActionError("진행 중인 생성이 끝난 뒤 재작성할 수 있습니다.");
        if (old.send_log_id) {
            const [sent] =
                await conn`SELECT id FROM email_send_logs WHERE id=${old.send_log_id} AND org_id=${input.orgId}
                AND (status IN('pending','sent','delivered','uncertain') OR status='failed' AND request_id IS NOT NULL AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL))`;
            if (sent) throw new CopyActionError("이미 발송이 시작된 작업은 재작성할 수 없습니다.");
        }
        const root = await rootJob(conn, input.orgId, old.id);
        const initialSource = /^initial:(\d+):(\d+):/.exec(root.idempotency_key);
        if (initialSource) {
            const [pending] =
                await conn`SELECT id FROM email_send_logs WHERE org_id=${input.orgId} AND auto_personalized_link_id=${Number(initialSource[1])} AND record_id=${Number(initialSource[2])} AND status IN('pending','uncertain') LIMIT 1`;
            if (pending)
                throw new CopyActionError("이 고객의 발송이 시작됐거나 결과 확인 중입니다.");
        }
        const ackId = /^visit-ack:(\d+)$/.exec(root.idempotency_key)?.[1];
        if (ackId) {
            const [ack] =
                await conn`SELECT id FROM email_visit_acknowledgements WHERE id=${Number(ackId)} AND org_id=${input.orgId} AND status='pending' FOR UPDATE`;
            if (!ack) throw new CopyActionError("감사 메일이 이미 발송됐거나 종료된 예약입니다.");
        }
        const [sending] =
            await conn`SELECT id FROM email_prepared_sends WHERE org_id=${input.orgId} AND payload->>'aiCopyJobId'=${String(old.id)} AND status IN('sending','sent','uncertain') LIMIT 1`;
        if (sending) throw new CopyActionError("이미 발송이 시작된 예약입니다.");
        const [policy] = await conn<
            CopyVersion<PolicySnapshot>[]
        >`SELECT * FROM ai_copy_policy_versions WHERE id=${input.policyVersionId} AND org_id=${input.orgId} AND workspace_id=${old.workspace_id} AND purpose=${old.purpose} AND state='approved' FOR SHARE`;
        const [knowledge] = await conn<
            CopyVersion<KnowledgeSnapshot>[]
        >`SELECT * FROM ai_copy_knowledge_versions WHERE id=${input.knowledgeVersionId} AND org_id=${input.orgId} AND workspace_id=${old.workspace_id} AND state='approved' FOR SHARE`;
        if (!policy || !knowledge)
            throw new CopyActionError("같은 사업과 목적의 승인 버전을 선택해 주세요.");
        const replacement = await ensureGenerationJob(conn, {
            orgId: input.orgId,
            workspaceId: old.workspace_id,
            purpose: old.purpose,
            key,
            policyVersionId: policy.id,
            knowledgeVersionId: knowledge.id,
            policy: policy.snapshot,
            knowledge: knowledge.snapshot,
            eligibleAt: input.now,
            context: old.approved_context ?? old.context,
            approvedContext: old.approved_context ?? old.context,
        });
        await conn`UPDATE ai_copy_generation_jobs SET requested_by=${input.userId} WHERE id=${replacement.id}`;
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='승인 버전으로 재작성 요청',superseded_by_id=${replacement.id},lease_token=NULL,lease_until=NULL,updated_at=${input.now.toISOString()} WHERE id=${old.id}`;
        return replacement;
    });
}
/** 새 본문이 완성된 뒤 선택한 예약만 다시 준비한다. 서명과 수신거부는 기존 발송 경로가 붙인다. */
export async function finalizeCopyReplacement(
    conn: CopyConnection,
    input: { orgId: string; id: number },
) {
    return copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824304,hashtext(${input.orgId}))`;
        const [fresh] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE id=${input.id} AND org_id=${input.orgId} AND origin='replacement' AND state='ready' FOR SHARE`;
        if (!fresh?.output) return false;
        const [old] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE superseded_by_id=${fresh.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!old || old.state === "cancelled") return false;
        const root = await rootJob(conn, input.orgId, old.id);
        const ackId = /^visit-ack:(\d+)$/.exec(root.idempotency_key)?.[1];
        if (ackId)
            await conn`UPDATE email_visit_acknowledgements SET body=NULL,updated_at=now() WHERE id=${Number(ackId)} AND org_id=${input.orgId} AND status='pending'`;
        await conn`UPDATE email_prepared_sends SET payload=NULL,status='reserved',updated_at=now() WHERE org_id=${input.orgId} AND payload->>'aiCopyJobId'=${String(old.id)} AND status IN('reserved','ready')`;
        await conn`UPDATE ai_copy_generation_jobs SET state='cancelled',reason='새 버전 작업으로 대체',updated_at=now() WHERE id=${old.id}`;
        return true;
    });
}
