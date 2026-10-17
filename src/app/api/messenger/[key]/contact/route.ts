import { NextRequest } from "next/server";
import { handleInbox, jsonBody, visitorToken } from "@/lib/inbox/http";
import { messengerHeaders, applyMessengerHeaders } from "@/lib/customer-platform/messenger-http";
import { selectedConversation } from "@/lib/inbox-customer-history/rules";
import { customerReplyContact } from "@/lib/customer-messenger/contact";
type Context = { params: Promise<{ key: string }> };
async function run(req: NextRequest, ctx: Context, write: boolean) {
    let headers: Record<string, string> = {};
    const response = await handleInbox(async () => {
        const { key } = await ctx.params;
        headers = await messengerHeaders(req, key);
        return customerReplyContact(key, visitorToken(req), selectedConversation(req.nextUrl.searchParams), write ? await jsonBody(req) : undefined);
    });
    return applyMessengerHeaders(response, headers);
}
export const GET = (req: NextRequest, ctx: Context) => run(req, ctx, false);
export const POST = (req: NextRequest, ctx: Context) => run(req, ctx, true);
export async function OPTIONS(req: NextRequest, ctx: Context) {
    let headers: Record<string, string> = {};
    const response = await handleInbox(async () => { headers = await messengerHeaders(req, (await ctx.params).key); return { ready: true }; });
    return applyMessengerHeaders(response, headers);
}
