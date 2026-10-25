import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { createPolicyVersion } from "@/lib/ai-copy/versions";
const selectorFilter = z.object({
    state: z.enum(["approved", "usable"]).optional(),
    purpose: z.enum(["initial_email", "visit_ack"]).optional(),
});
const input = z.object({
    workspaceId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    snapshot: z.unknown(),
});
export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const cursor = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("cursor") ?? 0);
        const workspaceId = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("workspaceId") ?? 0);
        // 선택기 전용 조회(UX-167): 승인(approved) 또는 사용 가능(blocked·retired 제외) 버전만 커서로 이어 받는다.
        const { state, purpose } = selectorFilter.parse({
            state: req.nextUrl.searchParams.get("state") ?? undefined,
            purpose: req.nextUrl.searchParams.get("purpose") ?? undefined,
        });
        const versions =
            await conn`SELECT v.*,u.name AS last_changed_by_name FROM ai_copy_policy_versions v LEFT JOIN users u ON u.id=v.last_changed_by
                WHERE v.org_id=${user.orgId} AND (${workspaceId}=0 OR v.workspace_id=${workspaceId}) AND (${cursor}=0 OR v.id<${cursor})
                AND (${state ?? ""}='' OR (${state ?? ""}='approved' AND v.state='approved') OR (${state ?? ""}='usable' AND v.state NOT IN ('blocked','retired')))
                AND (${purpose ?? ""}='' OR v.purpose=${purpose ?? ""})
                ORDER BY v.id DESC LIMIT 51`;
        const page = {
            versions: versions.slice(0, 50),
            nextCursor: versions.length > 50 ? versions[49].id : null,
        };
        if (state) return page;
        const workspaces =
            await conn`SELECT id,name FROM workspaces WHERE org_id=${user.orgId} ORDER BY id`;
        const rules =
            await conn`SELECT l.id,l.name,l.partition_id,p.workspace_id FROM email_auto_personalized_links l JOIN partitions p ON p.id=l.partition_id JOIN workspaces w ON w.id=p.workspace_id AND w.org_id=l.org_id WHERE l.org_id=${user.orgId} ORDER BY l.id`;
        const bindings = await conn`SELECT * FROM ai_copy_bindings WHERE org_id=${user.orgId}`;
        return {
            ...page,
            workspaces,
            rules,
            bindings,
        };
    });
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) =>
        createPolicyVersion(conn, {
            ...input.parse(await req.json()),
            orgId: user.orgId,
            userId: user.userId,
        }),
    );
