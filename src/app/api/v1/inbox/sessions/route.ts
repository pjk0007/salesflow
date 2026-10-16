import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import {
    authenticatePlatform,
    authorizeChannel,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import { platformContact } from "@/lib/customer-platform/repository";
import { issueCustomerIdentity } from "@/lib/customer-platform/identity";
import { connectVerifiedLead } from "@/lib/inbox-journey/repository";
import { canAccessWorkspace } from "@/lib/customer-platform/rules";
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = z
                .object({
                    channelId: z.number().int().positive(),
                    contactId: z.string().uuid(),
                })
                .strict()
                .parse(await jsonBody(req));
        const channel = await authorizeChannel(ctx, input.channelId, "create");
        await authorizeWorkspace(ctx, channel.workspaceId, "read");
        if (!channel.enabled)
            throw new InboxError("상담창이 꺼져 있습니다.", 503);
        const contact = await platformContact(
            ctx.token.orgId,
            channel.workspaceId,
            input.contactId,
        );
        if (canAccessWorkspace(ctx.token.scopes, channel.workspaceId, "update")) {
            await authorizeWorkspace(ctx, channel.workspaceId, "update");
            await connectVerifiedLead(ctx.token.orgId, channel.workspaceId, contact.id);
        }
        return {
            ...issueCustomerIdentity(contact.id, channel.publicKey),
            channelKey: channel.publicKey,
        };
    });
}
