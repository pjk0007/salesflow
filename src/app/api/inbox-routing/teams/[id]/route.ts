import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { readTeam, saveTeam } from "@/lib/inbox-routing/repository";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: Context) {
    return handleInbox(async () =>
        readTeam(
            inboxActor(req),
            z
                .string()
                .uuid()
                .parse((await c.params).id),
        ),
    );
}
export async function PATCH(req: NextRequest, c: Context) {
    return handleInbox(async () =>
        saveTeam(
            inboxActor(req),
            z
                .string()
                .uuid()
                .parse((await c.params).id),
            await jsonBody(req),
        ),
    );
}
