import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import {
    conversationDetail,
    patchConversation,
    sendAgentMessage,
} from "@/lib/inbox/repository";
import {
    authenticatePlatform,
    authorizeConversation,
} from "@/lib/customer-platform/external-auth";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        await authorizeConversation(ctx, id, "read");
        return conversationDetail(
            ctx.actor,
            id,
            undefined,
            Number(req.nextUrl.searchParams.get("before")) || undefined,
            req.nextUrl.searchParams.has("focusMessageId")
                ? z.coerce
                      .number()
                      .int()
                      .positive()
                      .parse(req.nextUrl.searchParams.get("focusMessageId"))
                : undefined,
        );
    });
}
export async function PATCH(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        await authorizeConversation(ctx, id, "update");
        return patchConversation(ctx.actor, id, await jsonBody(req));
    });
}
export async function POST(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        await authorizeConversation(ctx, id, "create");
        return sendAgentMessage(ctx.actor, id, await jsonBody(req));
    });
}
