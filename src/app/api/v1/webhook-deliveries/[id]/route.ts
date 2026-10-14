import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import {
    webhookDeliveryDetail,
    retryWebhook,
} from "@/lib/customer-platform/webhook-repository";
type C = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: C) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        return webhookDeliveryDetail(
            await webhookActor(req, true, { deliveryId: id }),
            id,
        );
    });
}
export async function POST(req: NextRequest, c: C) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        z.literal("retry").parse((await jsonBody(req)).action);
        return retryWebhook(
            await webhookActor(req, true, { deliveryId: id }, true),
            id,
        );
    });
}
