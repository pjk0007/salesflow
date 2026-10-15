import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { listTeams, saveTeam } from "@/lib/inbox-routing/repository";
export async function GET(req: NextRequest) {
    return handleInbox(() =>
        listTeams(
            inboxActor(req),
            z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId")),
        ),
    );
}
export async function POST(req: NextRequest) {
    return handleInbox(async () =>
        saveTeam(inboxActor(req), null, await jsonBody(req)),
    );
}
