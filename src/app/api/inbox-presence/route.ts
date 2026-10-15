import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import {
    heartbeat,
    presencePage,
    setAvailability,
} from "@/lib/inbox-presence/repository";
export async function GET(req: NextRequest) {
    return handleInbox(() =>
        presencePage(
            inboxActor(req),
            z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId")),
            req.nextUrl.searchParams.has("conversationId")
                ? z
                      .string()
                      .uuid()
                      .parse(req.nextUrl.searchParams.get("conversationId"))
                : null,
        ),
    );
}
export async function POST(req: NextRequest) {
    return handleInbox(async () =>
        heartbeat(inboxActor(req), await jsonBody(req)),
    );
}
export async function PATCH(req: NextRequest) {
    return handleInbox(async () =>
        setAvailability(inboxActor(req), await jsonBody(req)),
    );
}
