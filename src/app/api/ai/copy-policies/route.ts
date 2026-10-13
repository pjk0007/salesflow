import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { createPolicyVersion } from "@/lib/ai-copy/versions";
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
        const versions =
            await conn`SELECT v.*,u.name AS last_changed_by_name FROM ai_copy_policy_versions v LEFT JOIN users u ON u.id=v.last_changed_by
                WHERE v.org_id=${user.orgId} AND (${workspaceId}=0 OR v.workspace_id=${workspaceId}) AND (${cursor}=0 OR v.id<${cursor}) ORDER BY v.id DESC LIMIT 51`;
        const workspaces =
            await conn`SELECT id,name FROM workspaces WHERE org_id=${user.orgId} ORDER BY id`;
        const rules =
            await conn`SELECT l.id,l.name,l.partition_id,p.workspace_id FROM email_auto_personalized_links l JOIN partitions p ON p.id=l.partition_id JOIN workspaces w ON w.id=p.workspace_id AND w.org_id=l.org_id WHERE l.org_id=${user.orgId} ORDER BY l.id`;
        const bindings = await conn`SELECT * FROM ai_copy_bindings WHERE org_id=${user.orgId}`;
        return {
            versions: versions.slice(0, 50),
            nextCursor: versions.length > 50 ? versions[49].id : null,
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
