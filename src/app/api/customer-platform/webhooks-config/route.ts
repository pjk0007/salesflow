import { NextRequest } from "next/server";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { bootstrapInbox } from "@/lib/inbox/repository";
export async function GET(req: NextRequest) {
    return handleInbox(async () => bootstrapInbox(inboxActor(req)));
}
