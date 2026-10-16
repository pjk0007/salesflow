import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox } from "@/lib/inbox/http";
import { presencePage } from "@/lib/inbox-presence/repository";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            channelId = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId"));
        await authorizeChannel(ctx, channelId, "read");
        return presencePage(
            ctx.actor,
            channelId,
            req.nextUrl.searchParams.has("conversationId")
                ? z
                      .string()
                      .uuid()
                      .parse(req.nextUrl.searchParams.get("conversationId"))
                : null,
        );
    });
}
