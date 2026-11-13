import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * 리드관리에서 사업부 탭 빼기 — 그 사업부의 리드함(category = 'lead')과 리드 폴더를 지운다.
 * 리드가 하나라도 있거나, 웹 폼·자동발송·광고 연동이 걸린 리드함이 있으면 지우지 않는다 (함께 지워지므로).
 */
export async function removeLeadWorkspace(orgId: string, workspaceId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    return db.transaction(async (tx) => {
        const [check] = Array.from(
            await tx.execute<{ owned: boolean; parts: number; leads: number; linked: number }>(sql`
                WITH p AS (
                    SELECT p.id FROM partitions p JOIN workspaces w ON w.id = p.workspace_id
                    WHERE w.id = ${workspaceId} AND w.org_id = ${orgId} AND p.category = 'lead'
                )
                SELECT
                    EXISTS (SELECT 1 FROM workspaces WHERE id = ${workspaceId} AND org_id = ${orgId}) AS owned,
                    (SELECT count(*) FROM p)::int AS parts,
                    (SELECT count(*) FROM records WHERE partition_id IN (SELECT id FROM p))::int AS leads,
                    ((SELECT count(*) FROM web_forms WHERE partition_id IN (SELECT id FROM p))
                     + (SELECT count(*) FROM email_template_links WHERE partition_id IN (SELECT id FROM p))
                     + (SELECT count(*) FROM alimtalk_template_links WHERE partition_id IN (SELECT id FROM p))
                     + (SELECT count(*) FROM email_auto_personalized_links WHERE partition_id IN (SELECT id FROM p))
                     + (SELECT count(*) FROM ad_lead_integrations WHERE partition_id IN (SELECT id FROM p)))::int AS linked
            `),
        );
        if (!check?.owned) return { ok: false as const, error: "사업부를 찾을 수 없습니다." };
        if (check.leads > 0) return { ok: false as const, error: `리드가 ${check.leads}건 있어 뺄 수 없습니다.` };
        if (check.linked > 0) return { ok: false as const, error: "웹 폼이나 자동발송이 연결된 리드함이 있어 뺄 수 없습니다." };

        await tx.execute(sql`DELETE FROM partitions WHERE workspace_id = ${workspaceId} AND category = 'lead'`);
        await tx.execute(sql`DELETE FROM folders WHERE workspace_id = ${workspaceId} AND category = 'lead'`);
        return { ok: true as const };
    });
}
