import type { CopyConnection, CopyVersion, KnowledgeSnapshot, PolicySnapshot } from "./types";
import { fingerprint, knowledgeSchema, policySchema } from "./rules";
import { copyTransaction } from "./generation";
import { CopyActionError } from "./errors";

async function requireWorkspace(conn: CopyConnection, orgId: string, workspaceId: number) {
    const [workspace] =
        await conn`SELECT id FROM workspaces WHERE id=${workspaceId} AND org_id=${orgId}`;
    if (!workspace) throw new CopyActionError("사업을 찾을 수 없습니다.");
}
export async function createKnowledgeVersion(
    conn: CopyConnection,
    input: { orgId: string; workspaceId: number; userId: string; name: string; snapshot: unknown },
) {
    await requireWorkspace(conn, input.orgId, input.workspaceId);
    const snapshot = knowledgeSchema.parse(input.snapshot);
    const [version] = await conn<
        CopyVersion<KnowledgeSnapshot>[]
    >`INSERT INTO ai_copy_knowledge_versions(org_id,workspace_id,name,snapshot,fingerprint,created_by,last_changed_by,state_reason)
        VALUES(${input.orgId},${input.workspaceId},${input.name},${JSON.stringify(snapshot)}::jsonb,${fingerprint(snapshot)},${input.userId},${input.userId},'초안 생성') RETURNING *`;
    return version;
}
export async function createPolicyVersion(
    conn: CopyConnection,
    input: { orgId: string; workspaceId: number; userId: string; name: string; snapshot: unknown },
) {
    await requireWorkspace(conn, input.orgId, input.workspaceId);
    const snapshot = policySchema.parse(input.snapshot);
    const [version] = await conn<
        CopyVersion<PolicySnapshot>[]
    >`INSERT INTO ai_copy_policy_versions(org_id,workspace_id,name,purpose,snapshot,fingerprint,created_by,last_changed_by,state_reason)
        VALUES(${input.orgId},${input.workspaceId},${input.name},${snapshot.purpose},${JSON.stringify(snapshot)}::jsonb,${fingerprint(snapshot)},${input.userId},${input.userId},'초안 생성') RETURNING *`;
    return version;
}
export async function approveKnowledge(
    conn: CopyConnection,
    input: { orgId: string; id: number; userId: string; now: Date },
) {
    return copyTransaction(conn, async () => {
        const [version] = await conn<
            CopyVersion<KnowledgeSnapshot>[]
        >`SELECT * FROM ai_copy_knowledge_versions WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!version || !["draft", "evaluated"].includes(version.state))
            throw new CopyActionError("승인할 수 있는 지식 버전이 아닙니다.");
        const snapshot = knowledgeSchema.parse(version.snapshot);
        if (
            snapshot.claims.some(
                (c) =>
                    new Date(c.checkedAt) > input.now ||
                    input.now.getTime() - new Date(c.checkedAt).getTime() > 90 * 24 * 3600_000,
            )
        )
            throw new CopyActionError("지식 근거의 확인 시점을 최근 90일 이내로 갱신해 주세요.");
        await conn`UPDATE ai_copy_knowledge_versions SET state='approved',approved_by=${input.userId},approved_at=${input.now.toISOString()},last_changed_by=${input.userId},last_changed_at=${input.now.toISOString()},state_reason='근거 확인 후 승인' WHERE id=${version.id}`;
    });
}
export async function bindCopyVersions(
    conn: CopyConnection,
    input: {
        orgId: string;
        workspaceId: number;
        userId: string;
        purpose: PolicySnapshot["purpose"];
        ruleId: number;
        policyVersionId: number;
        knowledgeVersionId: number;
    },
    insideTransaction = false,
) {
    const apply = async () => {
        await requireWorkspace(conn, input.orgId, input.workspaceId);
        const [policy] = await conn<
            CopyVersion<PolicySnapshot>[]
        >`SELECT * FROM ai_copy_policy_versions WHERE id=${input.policyVersionId} AND org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND purpose=${input.purpose} AND state='approved' FOR SHARE`;
        const [knowledge] = await conn<
            CopyVersion<KnowledgeSnapshot>[]
        >`SELECT * FROM ai_copy_knowledge_versions WHERE id=${input.knowledgeVersionId} AND org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND state='approved' FOR SHARE`;
        if (!policy || !knowledge)
            throw new CopyActionError("같은 사업의 승인된 지식과 작성 지침이 필요합니다.");
        if (input.purpose === "initial_email") {
            const [rule] =
                await conn`SELECT l.id FROM email_auto_personalized_links l JOIN partitions p ON p.id=l.partition_id
                WHERE l.id=${input.ruleId} AND l.org_id=${input.orgId} AND p.workspace_id=${input.workspaceId}`;
            if (!rule) throw new CopyActionError("해당 사업의 이메일 규칙을 선택해 주세요.");
        } else if (input.ruleId !== 0)
            throw new CopyActionError("감사 메일 연결에는 규칙 번호를 지정하지 않습니다.");
        // 기존 작업과 실험은 스냅샷을 보존한다. 이 연결은 새 작업에만 사용한다.
        await conn`INSERT INTO ai_copy_bindings(org_id,workspace_id,purpose,rule_id,policy_version_id,knowledge_version_id,changed_by)
            VALUES(${input.orgId},${input.workspaceId},${input.purpose},${input.ruleId},${policy.id},${knowledge.id},${input.userId})
            ON CONFLICT(org_id,workspace_id,purpose,rule_id) DO UPDATE SET policy_version_id=EXCLUDED.policy_version_id,knowledge_version_id=EXCLUDED.knowledge_version_id,changed_by=EXCLUDED.changed_by,changed_at=now()`;
    };
    return insideTransaction ? apply() : copyTransaction(conn, apply);
}
export async function blockVersion(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId?: string;
        id: number;
        kind: "policy" | "knowledge";
        reason: string;
    },
) {
    if (input.reason.trim().length < 10)
        throw new CopyActionError("차단 이유를 10자 이상 적어 주세요.");
    return copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824304,hashtext(${input.orgId}))`;
        const versions =
            input.kind === "policy"
                ? await conn`UPDATE ai_copy_policy_versions SET state='blocked',last_changed_by=${input.userId ?? null},last_changed_at=now(),state_reason=${input.reason} WHERE id=${input.id} AND org_id=${input.orgId} RETURNING id`
                : await conn`UPDATE ai_copy_knowledge_versions SET state='blocked',last_changed_by=${input.userId ?? null},last_changed_at=now(),state_reason=${input.reason} WHERE id=${input.id} AND org_id=${input.orgId} RETURNING id`;
        if (!versions.length) throw new CopyActionError("버전을 찾을 수 없습니다.");
        const held =
            await conn`UPDATE ai_copy_generation_jobs SET state='held',reason=${`blocked_version: ${input.reason}`},lease_until=NULL,lease_token=NULL,updated_at=now()
            WHERE org_id=${input.orgId} AND origin IN('operational','replacement') AND state<>'cancelled'
            AND ((${input.kind}='policy' AND policy_version_id=${input.id}) OR (${input.kind}='knowledge' AND knowledge_version_id=${input.id}))
            AND (send_log_id IS NULL OR NOT EXISTS(SELECT 1 FROM email_send_logs l WHERE l.id=send_log_id AND (l.status IN ('pending','sent','delivered','uncertain') OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL))))
            RETURNING id`;
        const experiments =
            await conn`UPDATE email_copy_experiments SET state=CASE WHEN state='closed' THEN state ELSE 'invalidated' END,
            invalidation_reason=${`사용 버전 차단: ${input.reason}`},pending_mode='hold' WHERE org_id=${input.orgId}
            AND ((${input.kind}='policy' AND ((config->>'policyAId')::int=${input.id} OR (config->>'policyBId')::int=${input.id}))
                OR (${input.kind}='knowledge' AND (config->>'knowledgeVersionId')::int=${input.id})) RETURNING id`;
        if (experiments.length)
            await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='실험 사용 버전 차단',lease_until=NULL,lease_token=NULL WHERE org_id=${input.orgId}
            AND send_log_id IS NULL AND assignment_id IN(SELECT a.id FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id WHERE e.org_id=${input.orgId} AND e.invalidation_reason IS NOT NULL)`;
        return { heldJobs: held.length };
    });
}
