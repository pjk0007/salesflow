import { NextRequest } from "next/server";
import { z } from "zod";
import {
    conversationDetail,
    markRead,
    patchConversation,
    sendAgentMessage,
} from "@/lib/inbox/repository";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
type Context = { params: Promise<{ id: string }> };
async function chatId(ctx: Context) {
    return z
        .string()
        .uuid()
        .parse((await ctx.params).id);
}
export async function GET(req: NextRequest, ctx: Context) {
    return handleInbox(async () =>
        conversationDetail(
            inboxActor(req),
            await chatId(ctx),
            undefined,
            Number(req.nextUrl.searchParams.get("before")) || undefined,
            req.nextUrl.searchParams.has("focusMessageId")
                ? z.coerce
                      .number()
                      .int()
                      .positive()
                      .parse(req.nextUrl.searchParams.get("focusMessageId"))
                : undefined,
        ),
    );
}
export async function PATCH(req: NextRequest, ctx: Context) {
    return handleInbox(async () =>
        patchConversation(
            inboxActor(req),
            await chatId(ctx),
            await jsonBody(req),
        ),
    );
}
export async function POST(req: NextRequest, ctx: Context) {
    return handleInbox(async () => {
        const actor = inboxActor(req),
            id = await chatId(ctx),
            body = await jsonBody(req);
        if (body.action === "read") {
            await markRead(
                actor,
                id,
                z.number().int().nonnegative().parse(body.customerSeq),
            );
            return { read: true };
        }
        return sendAgentMessage(actor, id, body);
    });
}
