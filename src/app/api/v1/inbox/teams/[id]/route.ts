import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { readTeam, saveTeam } from "@/lib/inbox-routing/repository";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            team = await readTeam(ctx.actor, id);
        await authorizeChannel(ctx, team.channelId, "read");
        return team;
    });
}
export async function PATCH(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            team = await readTeam(ctx.actor, id);
        await authorizeChannel(ctx, team.channelId, "update");
        return saveTeam(ctx.actor, id, await jsonBody(req));
    });
}
