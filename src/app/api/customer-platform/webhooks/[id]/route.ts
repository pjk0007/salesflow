import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import {
    webhookDetail,
    updateWebhook,
    testWebhook,
    retryWebhookDeliveries,
} from "@/lib/customer-platform/webhook-repository";
type C = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: C) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        return webhookDetail(
            await webhookActor(req, false, { endpointId: id }),
            id,
        );
    });
}
export async function PATCH(req: NextRequest, c: C) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        return updateWebhook(
            await webhookActor(req, false, { endpointId: id }, true),
            id,
            await jsonBody(req),
        );
    });
}
export async function POST(req: NextRequest, c: C) {
    return handleInbox(async () => {
        const id = z
                .string()
                .uuid()
                .parse((await c.params).id),
            actor = await webhookActor(req, false, { endpointId: id }, true),
            body = await jsonBody(req);
        if (body.action === "test")
            return testWebhook(
                actor,
                id,
                z.string().uuid().parse(body.clientId),
            );
        if (body.action === "retry_deliveries")
            return retryWebhookDeliveries(
                actor,
                id,
                z.enum(["retry", "dead", "cancelled"]).parse(body.state),
            );
        z.literal("rotate").parse(body.action);
        return updateWebhook(actor, id, { version: body.version }, true);
    });
}
