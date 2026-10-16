import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import {
    listWebhooks,
    createWebhook,
} from "@/lib/customer-platform/webhook-repository";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const workspaceId = z.coerce
            .number()
            .int()
            .positive()
            .parse(req.nextUrl.searchParams.get("workspaceId"));
        return listWebhooks(
            await webhookActor(req, false, { workspaceId }),
            workspaceId,
        );
    });
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const body = await jsonBody(req),
            workspaceId = z.number().int().positive().parse(body.workspaceId);
        return createWebhook(
            await webhookActor(req, false, { workspaceId }, true, true),
            body,
        );
    });
}
