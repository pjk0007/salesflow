import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { accessRoster, changeAccess } from "@/lib/customer-access/repository";
const ws = (req: NextRequest) =>
    z.coerce
        .number()
        .int()
        .positive()
        .parse(req.nextUrl.searchParams.get("workspaceId"));
export async function GET(req: NextRequest) {
    return handleInbox(() =>
        accessRoster(
            inboxActor(req),
            ws(req),
            undefined,
            req.nextUrl.searchParams.get("before") ?? undefined,
        ),
    );
}
export async function POST(req: NextRequest) {
    return handleInbox(async () =>
        changeAccess(inboxActor(req), ws(req), await jsonBody(req)),
    );
}
