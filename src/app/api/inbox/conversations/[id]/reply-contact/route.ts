import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, customerReplyContacts } from "@/lib/db";
import { ownedConversation } from "@/lib/inbox/repository";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    return handleInbox(async () => {
        const id = z.string().uuid().parse((await ctx.params).id);
        await ownedConversation(inboxActor(req), id);
        const [c] = await db.select().from(customerReplyContacts).where(eq(customerReplyContacts.conversationId, id));
        return c ? { name: c.name, phone: c.phone, email: c.email, notifyEmail: c.notifyEmail && !!c.verifiedAt && !!c.consentAt } : null;
    });
}
