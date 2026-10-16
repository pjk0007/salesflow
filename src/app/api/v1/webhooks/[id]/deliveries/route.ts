import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import { webhookDeliveryPage } from "@/lib/customer-platform/webhook-repository";
export async function GET(
    req: NextRequest,
    c: { params: Promise<{ id: string }> },
) {
    return handleInbox(async () => {
        const id = z
            .string()
            .uuid()
            .parse((await c.params).id);
        return webhookDeliveryPage(
            await webhookActor(req, true, { endpointId: id }),
            id,
            req.nextUrl.searchParams.get("before") ?? undefined,
            req.nextUrl.searchParams.get("state") ?? undefined,
        );
    });
}
