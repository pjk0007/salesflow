import { NextRequest } from "next/server";
import { z } from "zod";
import { deleteMacro, listMacros, saveMacro } from "@/lib/inbox-macros/repository";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
const workspace = (req: NextRequest) => z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("workspaceId"));
export async function GET(req: NextRequest) {
    return handleInbox(async () => listMacros(inboxActor(req), workspace(req)));
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => saveMacro(inboxActor(req), workspace(req), await jsonBody(req)));
}
export async function DELETE(req: NextRequest) {
    return handleInbox(async () =>
        deleteMacro(inboxActor(req), workspace(req), z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("id"))),
    );
}
