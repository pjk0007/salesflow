import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { createEvaluationRun } from "@/lib/ai-copy/evaluations";
const input = z.object({
    purpose: z.enum(["initial_email", "visit_ack"]),
    pairs: z
        .array(
            z.object({
                workspaceId: z.number().int().positive(),
                baselinePolicyId: z.number().int().positive(),
                candidatePolicyId: z.number().int().positive(),
                knowledgeVersionId: z.number().int().positive(),
            }),
        )
        .length(2),
});
export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const cursor = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("cursor") ?? 0);
        const runs =
            await conn`SELECT * FROM ai_copy_evaluation_runs WHERE org_id=${user.orgId} AND (${cursor}=0 OR id<${cursor}) ORDER BY id DESC LIMIT 21`;
        return { runs: runs.slice(0, 20), nextCursor: runs.length > 20 ? runs[19].id : null };
    });
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) =>
        createEvaluationRun(conn, {
            ...input.parse(await req.json()),
            orgId: user.orgId,
            userId: user.userId,
        }),
    );
