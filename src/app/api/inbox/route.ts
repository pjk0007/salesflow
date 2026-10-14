import { NextRequest } from "next/server";
import { z } from "zod";
import { bootstrapInbox, listConversations } from "@/lib/inbox/repository";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const actor = inboxActor(req), value = req.nextUrl.searchParams.get("channelId");
        if (!value) return bootstrapInbox(actor);
        const channel = z.coerce.number().int().positive().parse(value);
        const before = req.nextUrl.searchParams.get("before");
        return listConversations(
            actor,
            channel,
            undefined,
            before && Number.isFinite(Date.parse(before))
                ? new Date(before)
                : undefined,
            req.nextUrl.searchParams.get("beforeId") ? z.string().uuid().parse(req.nextUrl.searchParams.get("beforeId")) : undefined,
        );
    });
}
