import { NextRequest } from "next/server";
import { handleInbox } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { publicChannel } from "@/lib/inbox/repository";
import { messengerHeaders, applyMessengerHeaders } from "@/lib/customer-platform/messenger-http";
import { firebaseSiteProvider, verifyFirebaseSiteMember } from "@/lib/customer-platform/firebase-site-identity";
import { upsertContact } from "@/lib/customer-platform/repository";
import { issueCustomerIdentity } from "@/lib/customer-platform/identity";
import { connectVerifiedLead } from "@/lib/inbox-journey/repository";
type Context = { params: Promise<{ key: string }> };
async function run(req: NextRequest, ctx: Context, action: (key: string) => Promise<unknown>) {
    let headers: Record<string, string> = {};
    const response = await handleInbox(async () => {
        const { key } = await ctx.params;
        headers = await messengerHeaders(req, key);
        return action(key);
    });
    response.headers.set("Cache-Control", "no-store");
    return applyMessengerHeaders(response, headers);
}
export async function OPTIONS(req: NextRequest, ctx: Context) {
    return run(req, ctx, async key => { firebaseSiteProvider(key); return { ready: true }; });
}
export async function POST(req: NextRequest, ctx: Context) {
    return run(req, ctx, async key => {
        const provider = firebaseSiteProvider(key);
        const token = /^Bearer (\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
        if (!token) throw new InboxError("사이트 로그인이 필요합니다.", 401);
        const member = await verifyFirebaseSiteMember(provider, token);
        const channel = await publicChannel(key);
        const contact = await upsertContact(channel.orgId, { workspaceId: channel.workspaceId, ...member }, true, undefined, { source: "system" });
        await connectVerifiedLead(channel.orgId, channel.workspaceId, contact.id);
        return { ...issueCustomerIdentity(contact.id, key), channelKey: key };
    });
}
