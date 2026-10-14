import { requireCustomerAccess } from "@/lib/customer-access/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeWorkspace,
} from "@/lib/customer-platform/external-auth";
import {
    importOwned,
    importPage,
    importDetail,
    importSource,
    previewImport,
    changeImport,
    stepImport,
} from "./repository";
import type { PlatformPermission } from "@/lib/customer-platform/rules";
const ws = z.coerce.number().int().positive(),
    uuid = z.string().uuid();
type Context = { params: Promise<{ id: string }> };
async function actorFor(
    req: NextRequest,
    external: boolean,
    workspaceId: number,
    permission: PlatformPermission,
) {
    const ctx = external ? await authenticatePlatform(req) : null;
    const actor = ctx?.actor ?? inboxActor(req);
    if (ctx) await authorizeWorkspace(ctx, workspaceId, permission);
    await requireCustomerAccess(actor, workspaceId, "manage");
    return actor;
}
async function ownedActor(
    req: NextRequest,
    external: boolean,
    id: string,
    permission: PlatformPermission,
) {
    const preliminary = external
            ? (await authenticatePlatform(req)).actor
            : inboxActor(req),
        job = await importOwned(preliminary, id);
    return actorFor(req, external, job.workspaceId, permission);
}
export function importCollectionHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = ws.parse(
                    req.nextUrl.searchParams.get("workspaceId"),
                );
                return importPage(
                    await actorFor(req, external, workspaceId, "read"),
                    workspaceId,
                    req.nextUrl.searchParams.has("before")
                        ? uuid.parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const input = await jsonBody(req, 12000000),
                    workspaceId = ws.parse(input.workspaceId);
                return previewImport(
                    await actorFor(req, external, workspaceId, "create"),
                    input,
                );
            }),
    };
}
export function importItemHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id),
                    actor = await ownedActor(req, external, id, "read");
                if (req.nextUrl.searchParams.get("source") === "1")
                    return importSource(actor, id);
                return importDetail(
                    actor,
                    id,
                    undefined,
                    req.nextUrl.searchParams.has("offset")
                        ? z.coerce
                              .number()
                              .int()
                              .min(0)
                              .parse(req.nextUrl.searchParams.get("offset"))
                        : undefined,
                );
            }),
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id),
                    input = await jsonBody(req),
                    actor = await ownedActor(req, external, id, "update");
                if (input.action === "step") {
                    const { action: _, ...step } = input;
                    void _;
                    return stepImport(actor, id, step);
                }
                return changeImport(actor, id, input);
            }),
    };
}
