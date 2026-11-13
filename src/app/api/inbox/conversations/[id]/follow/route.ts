import { NextRequest } from "next/server";
import { z } from "zod";
import { followState, setFollow } from "@/lib/inbox-follow/repository";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
type Context = { params: Promise<{ id: string }> };
const chatId = async (ctx: Context) => z.string().uuid().parse((await ctx.params).id);
export async function GET(req: NextRequest, ctx: Context) {
    return handleInbox(async () => followState(inboxActor(req), await chatId(ctx)));
}
export async function POST(req: NextRequest, ctx: Context) {
    return handleInbox(async () => setFollow(inboxActor(req), await chatId(ctx), true));
}
export async function DELETE(req: NextRequest, ctx: Context) {
    return handleInbox(async () => setFollow(inboxActor(req), await chatId(ctx), false));
}
