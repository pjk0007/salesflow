import { NextRequest } from "next/server";
import { z } from "zod";
import { listResponders, setResponder } from "@/lib/inbox-responders/repository";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
const workspace = (req: NextRequest) => z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("workspaceId"));
export async function GET(req: NextRequest) {
    return handleInbox(async () => listResponders(inboxActor(req), workspace(req)));
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => setResponder(inboxActor(req), workspace(req), await jsonBody(req)));
}
