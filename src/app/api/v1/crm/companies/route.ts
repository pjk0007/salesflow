import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import {
    companyInput,
    canAccessWorkspace,
} from "@/lib/customer-platform/rules";
import {
    listPlatformObjects,
    upsertCompany,
} from "@/lib/customer-platform/repository";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            workspaceId = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("workspaceId")),
            before = req.nextUrl.searchParams.get("before");
        await authorizeWorkspace(ctx, workspaceId, "read");
        return listPlatformObjects(
            ctx.token.orgId,
            workspaceId,
            "companies",
            before ? z.string().uuid().parse(before) : undefined,
        );
    });
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = companyInput.parse(await jsonBody(req));
        await authorizeWorkspace(ctx, input.workspaceId, "read");
        const mayUpdate = canAccessWorkspace(
            ctx.token.scopes,
            input.workspaceId,
            "update",
        );
        await authorizeWorkspace(ctx, input.workspaceId, "create");
        return upsertCompany(ctx.token.orgId, input, mayUpdate);
    });
}
