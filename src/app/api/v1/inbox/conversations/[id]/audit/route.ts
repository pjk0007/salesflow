import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox } from "@/lib/inbox/http";
import { ownedConversation } from "@/lib/inbox/repository";
import { inboxAuditPage } from "@/lib/inbox/audit";
import {
    authenticatePlatform,
    authorizeConversation,
} from "@/lib/customer-platform/external-auth";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        const ctx = await authenticatePlatform(req);
        await authorizeConversation(ctx, id, "read");
        const actor = ctx.actor;
        const chat = await ownedConversation(actor, id);
        return inboxAuditPage(
            actor.orgId,
            chat.channelId,
            id,
            req.nextUrl.searchParams.get("before") ?? undefined,
        );
    });
}
