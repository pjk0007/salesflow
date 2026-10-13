import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { createKnowledgeVersion } from "@/lib/ai-copy/versions";
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
            await conn`SELECT v.*,u.name AS last_changed_by_name FROM ai_copy_knowledge_versions v LEFT JOIN users u ON u.id=v.last_changed_by
                WHERE v.org_id=${user.orgId} AND (${workspaceId}=0 OR v.workspace_id=${workspaceId}) AND (${cursor}=0 OR v.id<${cursor}) ORDER BY v.id DESC LIMIT 51`;
        return {
            versions: versions.slice(0, 50),
            nextCursor: versions.length > 50 ? versions[49].id : null,
        };
    });
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) =>
        createKnowledgeVersion(conn, {
            ...input.parse(await req.json()),
            orgId: user.orgId,
            userId: user.userId,
        }),
    );
