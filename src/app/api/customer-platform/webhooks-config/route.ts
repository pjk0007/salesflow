import { NextRequest } from "next/server";
import { handleInbox } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import { bootstrapInbox } from "@/lib/inbox/repository";
export async function GET(req: NextRequest) {
    return handleInbox(async () =>
        bootstrapInbox(await webhookActor(req, false, {})),
    );
}
