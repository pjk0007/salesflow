import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { capacityPage, setCapacity } from "@/lib/inbox-capacity/repository";
import { dispatchChannel } from "@/lib/inbox-capacity/dispatcher";
export async function GET(req: NextRequest) {
    return handleInbox(() =>
        capacityPage(
            inboxActor(req),
            z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId")),
        ),
    );
}
export async function PATCH(req: NextRequest) {
    return handleInbox(async () =>
        setCapacity(inboxActor(req), await jsonBody(req)),
    );
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const input = z
            .object({
                channelId: z.number().int().positive(),
                action: z.literal("dispatch"),
            })
            .strict()
            .parse(await jsonBody(req));
        return dispatchChannel(inboxActor(req), input.channelId);
    });
}
