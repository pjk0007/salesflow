import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import {
    listCustomerEvents,
    recordCustomerEvent,
} from "@/lib/customer-platform/repository";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            ws = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("workspaceId")),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        await authorizeWorkspace(ctx, ws, "read");
        const before = req.nextUrl.searchParams.get("before");
        return listCustomerEvents(
            ctx.token.orgId,
            ws,
            id,
            before ? z.string().uuid().parse(before) : undefined,
        );
    });
}
export async function POST(req: NextRequest, c: Context) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = await jsonBody(req),
            ws = z.number().int().positive().parse(input.workspaceId),
            id = z
                .string()
                .uuid()
                .parse((await c.params).id);
        await authorizeWorkspace(ctx, ws, "create");
        const { workspaceId: _, ...event } = input;
        void _;
        return recordCustomerEvent(ctx.token.orgId, ws, id, event, "server");
    });
}
