import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { approveKnowledge, blockVersion } from "@/lib/ai-copy/versions";
import { retireCopyVersion } from "@/lib/ai-copy/retirement";
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const body = z
            .object({
                action: z.enum(["approve", "block", "retire"]),
                reason: z.string().trim().min(10).max(1000).optional(),
            })
            .parse(await req.json());
        if (body.action === "block")
            return blockVersion(conn, {
                orgId: user.orgId,
                userId: user.userId,
                id,
                kind: "knowledge",
                reason: body.reason ?? "",
            });
        if (body.action === "retire")
            return retireCopyVersion(conn, {
                orgId: user.orgId,
                userId: user.userId,
                id,
                kind: "knowledge",
            });
        await approveKnowledge(conn, {
            orgId: user.orgId,
            userId: user.userId,
            id,
            now: new Date(),
        });
        return { approved: true };
    });
