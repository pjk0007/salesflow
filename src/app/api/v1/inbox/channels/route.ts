import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, inboxChannels } from "@/lib/db";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { saveChannel } from "@/lib/inbox/repository";
import { channelInput } from "@/lib/inbox/rules";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            ws = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("workspaceId"));
        await authorizeWorkspace(ctx, ws, "read");
        return db
            .select()
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.orgId, ctx.token.orgId),
                    eq(inboxChannels.workspaceId, ws),
                ),
            );
    });
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = channelInput.parse(await jsonBody(req));
        const [existing] = await db
            .select({ id: inboxChannels.id })
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.workspaceId, input.workspaceId),
                    eq(inboxChannels.orgId, ctx.token.orgId),
                ),
            );
        await authorizeWorkspace(
            ctx,
            input.workspaceId,
            existing ? "update" : "create",
        );
        return saveChannel(ctx.actor, input);
    });
}
