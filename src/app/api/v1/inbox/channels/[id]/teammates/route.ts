import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
import { mentionTeammates } from "@/lib/inbox-collaboration/mentions";
import { db } from "@/lib/db";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z.coerce
                .number()
                .int()
                .positive()
                .parse((await c.params).id);
        await authorizeChannel(ctx, id, "read");
        return mentionTeammates(ctx.actor, id, db);
    });
}
