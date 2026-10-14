import { NextRequest } from "next/server";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { bootstrapInbox, InboxError } from "@/lib/inbox/repository";
import { inboxAuditPage } from "@/lib/inbox/audit";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const actor = inboxActor(req),
            id = Number((await c.params).id),
            data = await bootstrapInbox(actor);
        if (!data.channels.some((ch) => ch.id === id))
            throw new InboxError("상담창을 찾을 수 없습니다.", 404);
        return inboxAuditPage(
            actor.orgId,
            id,
            null,
            req.nextUrl.searchParams.get("before") ?? undefined,
        );
    });
}
