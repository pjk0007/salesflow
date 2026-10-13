import type { CopyConnection } from "./types";
import { copyTransaction } from "./generation";
import { CopyActionError } from "./errors";
export async function retireCopyVersion(
    conn: CopyConnection,
    input: { orgId: string; userId: string; id: number; kind: "policy" | "knowledge" },
) {
    return copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824304,hashtext(${input.orgId}))`;
        const [bound] = await conn`SELECT 1 FROM ai_copy_bindings WHERE org_id=${input.orgId}
            AND ((${input.kind}='policy' AND policy_version_id=${input.id}) OR (${input.kind}='knowledge' AND knowledge_version_id=${input.id}))`;
        const [experiment] =
            await conn`SELECT id FROM email_copy_experiments WHERE org_id=${input.orgId} AND state IN('running','paused','enrollment_closed','observing','decision_ready','data_check','insufficient_sample')
            AND ((${input.kind}='policy' AND ((config->>'policyAId')::int=${input.id} OR (config->>'policyBId')::int=${input.id})) OR (${input.kind}='knowledge' AND (config->>'knowledgeVersionId')::int=${input.id}))`;
        if (bound || experiment)
            throw new CopyActionError(
                "연결이나 실험에서 사용 중인 버전입니다. 연결을 바꾸거나 실험을 종료한 뒤 보관해 주세요.",
            );
        const changed =
            input.kind === "policy"
                ? await conn`UPDATE ai_copy_policy_versions SET state='retired',last_changed_by=${input.userId},last_changed_at=now(),state_reason='새 연결에서 사용 종료' WHERE id=${input.id} AND org_id=${input.orgId} AND state<>'blocked' RETURNING id`
                : await conn`UPDATE ai_copy_knowledge_versions SET state='retired',last_changed_by=${input.userId},last_changed_at=now(),state_reason='새 연결에서 사용 종료' WHERE id=${input.id} AND org_id=${input.orgId} AND state<>'blocked' RETURNING id`;
        if (!changed.length) throw new CopyActionError("보관할 버전을 찾을 수 없습니다.");
        return { retired: true, existingJobs: "preserved" };
    });
}
