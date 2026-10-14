import { NextRequest } from "next/server";
import { saveChannel } from "@/lib/inbox/repository";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
export async function POST(req: NextRequest) {
    return handleInbox(async () =>
        saveChannel(inboxActor(req), await jsonBody(req)),
    );
}
