import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
import { capacityPage, setCapacity } from "@/lib/inbox-capacity/repository";
import { dispatchChannel } from "@/lib/inbox-capacity/dispatcher";
import { capacityInput } from "@/lib/inbox-capacity/rules";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            channelId = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId"));
        await authorizeChannel(ctx, channelId, "read");
        return capacityPage(ctx.actor, channelId);
    });
}
export async function PATCH(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = capacityInput.parse(await jsonBody(req));
        await authorizeChannel(ctx, input.channelId, "update");
        return setCapacity(ctx.actor, input);
    });
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = z
                .object({
                    channelId: z.number().int().positive(),
                    action: z.literal("dispatch"),
                })
                .strict()
                .parse(await jsonBody(req));
        await authorizeChannel(ctx, input.channelId, "update");
        return dispatchChannel(ctx.actor, input.channelId);
    });
}
