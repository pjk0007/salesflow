import { requireCustomerAccess } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { authenticatePlatform, authorizeWorkspace } from "./external-auth";
import { customerActivities } from "./activities";
export function activityHandler(external: boolean) {
    return async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handleInbox(async () => {
            const id = z
                    .string()
                    .uuid()
                    .parse((await ctx.params).id),
                workspaceId = z.coerce
                    .number()
                    .int()
                    .positive()
                    .parse(req.nextUrl.searchParams.get("workspaceId")),
                before = req.nextUrl.searchParams.get("before"),
                token = external ? await authenticatePlatform(req) : null,
                actor = token?.actor ?? inboxActor(req);
            if (token) await authorizeWorkspace(token, workspaceId, "read");
            else await requireCustomerAccess(actor, workspaceId);
            return customerActivities(
                actor.orgId,
                workspaceId,
                id,
                before ? z.string().uuid().parse(before) : undefined,
            );
        });
}
