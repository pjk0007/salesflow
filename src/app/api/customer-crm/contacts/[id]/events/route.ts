import { requireCustomerAccess } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { listCustomerEvents } from "@/lib/customer-platform/repository";
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const actor = inboxActor(req),
            id = z
                .string()
                .uuid()
                .parse((await ctx.params).id),
            workspaceId = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("workspaceId")),
            before = req.nextUrl.searchParams.get("before");
        await requireCustomerAccess(actor, workspaceId);
        return listCustomerEvents(
            actor.orgId,
            workspaceId,
            id,
            before ? z.string().uuid().parse(before) : undefined,
        );
    });
}
