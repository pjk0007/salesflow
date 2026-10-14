import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { inboxCustomerContext } from "@/lib/customer-platform/inbox-context";
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () =>
        inboxCustomerContext(
            inboxActor(req),
            z
                .string()
                .uuid()
                .parse((await ctx.params).id),
        ),
    );
}
