import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { bindCopyVersions } from "@/lib/ai-copy/versions";
const input = z.object({
    workspaceId: z.number().int().positive(),
    purpose: z.enum(["initial_email", "visit_ack"]),
    ruleId: z.number().int().nonnegative(),
    policyVersionId: z.number().int().positive(),
    knowledgeVersionId: z.number().int().positive(),
});
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        await bindCopyVersions(conn, {
            ...input.parse(await req.json()),
            orgId: user.orgId,
            userId: user.userId,
        });
        return { appliedTo: "new_jobs_only" };
    });
