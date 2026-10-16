import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox } from "@/lib/inbox/http";
import { listConversations } from "@/lib/inbox/repository";
import { readConversationFilters } from "@/lib/inbox/rules";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId"));
        await authorizeChannel(ctx, id, "read");
        const before = req.nextUrl.searchParams.get("before"),
            beforeId = req.nextUrl.searchParams.get("beforeId");
        return listConversations(
            ctx.actor,
            id,
            undefined,
            before
                ? new Date(z.iso.datetime({ offset: true }).parse(before))
                : undefined,
            beforeId ? z.string().uuid().parse(beforeId) : undefined,
            readConversationFilters(req.nextUrl.searchParams),
        );
    });
}
