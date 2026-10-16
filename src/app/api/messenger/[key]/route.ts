import {publicBusinessHours} from "@/lib/inbox-operations/repository";
import { NextRequest } from "next/server";
import { handleInbox, jsonBody, visitorToken } from "@/lib/inbox/http";
import {
    publicChannel,
    startVisitorSession,
    visitorDetail,
    sendVisitorMessage,
    authenticatedCustomer,
} from "@/lib/inbox/repository";
import { recordCustomerEvent } from "@/lib/customer-platform/repository";
import { linkVisitorIdentity } from "@/lib/inbox/link-identity";
import { updateVisitorProfile } from "@/lib/inbox/visitor-profile";
import { selectedConversation } from "@/lib/inbox-customer-history/rules";
import { attachJourneyContext } from "@/lib/inbox-journey/repository";
import {
    applyMessengerHeaders,
    messengerHeaders,
} from "@/lib/customer-platform/messenger-http";
type Context = { params: Promise<{ key: string }> };
async function run(
    req: NextRequest,
    ctx: Context,
    action: (key: string) => Promise<unknown>,
) {
    let headers: Record<string, string> = {};
    const response = await handleInbox(async () => {
        const { key } = await ctx.params;
        headers = await messengerHeaders(req, key);
        return action(key);
    });
    return applyMessengerHeaders(response, headers);
}
export async function OPTIONS(req: NextRequest, ctx: Context) {
    return run(req, ctx, async () => ({ ready: true }));
}
export async function GET(req: NextRequest, ctx: Context) {
    return run(req, ctx, async (key) => {
        if (visitorToken(req))
            return visitorDetail(
                key,
                visitorToken(req),
                undefined,
                Number(req.nextUrl.searchParams.get("before")) || undefined,
                selectedConversation(req.nextUrl.searchParams),
            );
        const channel = await publicChannel(key);
        return {
            name: channel.name,
            greeting: channel.greeting,
            businessHours:await publicBusinessHours(channel.id),
            color: channel.color,
            allowedOrigins: channel.allowedOrigins,
        };
    });
}
export async function POST(req: NextRequest, ctx: Context) {
    return run(req, ctx, async (key) => {
        const input = await jsonBody(req);
        if (input.action === "journey")
            return attachJourneyContext(key, visitorToken(req), input);
        if (input.action === "identify")
            return linkVisitorIdentity(key, visitorToken(req), input);
        if (input.action === "session") return startVisitorSession(key, input);
        if (input.action === "profile")
            return updateVisitorProfile(key, visitorToken(req), input);
        if (input.action === "track") {
            const { contact, channel } = await authenticatedCustomer(
                key,
                visitorToken(req),
            );
            const { action: _, ...event } = input;
            void _;
            return recordCustomerEvent(
                channel.orgId,
                channel.workspaceId,
                contact.id,
                event,
                "web",
            );
        }
        return sendVisitorMessage(key, visitorToken(req), input, undefined, selectedConversation(req.nextUrl.searchParams));
    });
}
