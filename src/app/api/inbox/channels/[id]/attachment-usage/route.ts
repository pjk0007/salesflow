import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { requireCustomerChannel } from "@/lib/customer-access/access";
import { channelAttachmentUsage } from "@/lib/inbox/files";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const id = z.coerce.number().int().positive().parse((await c.params).id);
        const channel = await requireCustomerChannel(inboxActor(req), id, "manage");
        return channelAttachmentUsage(channel.id);
    });
}
