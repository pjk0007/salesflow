import { NextRequest } from "next/server";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
import { conversationJourney } from "@/lib/inbox-journey/repository";
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    return handleInbox(async () => conversationJourney(inboxActor(req), (await context.params).id));
}
