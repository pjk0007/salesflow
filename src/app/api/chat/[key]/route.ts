import { NextRequest } from "next/server";
import {
    publicChannel,
    startVisitorSession,
    visitorDetail,
    sendVisitorMessage,
} from "@/lib/inbox/repository";
import {
    handleInbox,
    jsonBody,
    publicGuard,
    visitorToken,
} from "@/lib/inbox/http";
type Context = { params: Promise<{ key: string }> };
export async function GET(req: NextRequest, ctx: Context) {
    return handleInbox(async () => {
        const { key } = await ctx.params;
        publicGuard(req, key);
        if (visitorToken(req))
            return visitorDetail(
                key,
                visitorToken(req),
                undefined,
                Number(req.nextUrl.searchParams.get("before")) || undefined,
            );
        const channel = await publicChannel(key);
        return {
            name: channel.name,
            greeting: channel.greeting,
            color: channel.color,
            allowedOrigins: channel.allowedOrigins,
        };
    });
}
export async function POST(req: NextRequest, ctx: Context) {
    return handleInbox(async () => {
        const { key } = await ctx.params;
        publicGuard(req, key);
        const input = await jsonBody(req);
        if (input.action === "session") return startVisitorSession(key, input);
        return sendVisitorMessage(key, visitorToken(req), input);
    });
}
