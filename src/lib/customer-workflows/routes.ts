import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { webhookActor } from "@/lib/customer-platform/webhook-http";
import {
    workflowOwned,
    workflowList,
    workflowDetail,
    saveWorkflow,
    workflowEventPage,
    simulateWorkflow,
    publishWorkflow,
    disableWorkflow,
    enableWorkflow,
    workflowRunPage,
    workflowRunDetail,
    changeWorkflowRun,
} from "./repository";
import { inboxActor } from "@/lib/inbox/http";
type C = { params: Promise<{ id: string; runId?: string }> };
const uuid = z.string().uuid(),
    ws = z.coerce.number().int().positive();
async function actor(
    req: NextRequest,
    external: boolean,
    id: string,
    manage = false,
    create = false,
) {
    if (!external) {
        const preliminary = inboxActor(req),
            owned = await workflowOwned(preliminary, id);
        return webhookActor(
            req,
            false,
            { workspaceId: owned.workspaceId },
            manage,
            create,
        );
    }
    const { authenticatePlatform, authorizeWorkspace } = await import(
        "@/lib/customer-platform/external-auth"
    );
    const preliminary = await authenticatePlatform(req),
        owned = await workflowOwned(preliminary.actor, id);
    await authorizeWorkspace(preliminary, owned.workspaceId, "read");
    return webhookActor(
        req,
        true,
        { workspaceId: owned.workspaceId },
        manage,
        create,
    );
}
export function workflowCollectionHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = ws.parse(
                    req.nextUrl.searchParams.get("workspaceId"),
                );
                return workflowList(
                    await webhookActor(req, external, { workspaceId }),
                    workspaceId,
                    req.nextUrl.searchParams.has("before")
                        ? uuid.parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const input = await jsonBody(req, 250000),
                    workspaceId = ws.parse(input.workspaceId);
                return saveWorkflow(
                    await webhookActor(
                        req,
                        external,
                        { workspaceId },
                        true,
                        true,
                    ),
                    undefined,
                    input,
                );
            }),
    };
}
export function workflowItemHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id);
                return workflowDetail(await actor(req, external, id), id);
            }),
        PATCH: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id);
                return saveWorkflow(
                    await actor(req, external, id, true),
                    id,
                    await jsonBody(req, 250000),
                );
            }),
        POST: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id),
                    who = await actor(req, external, id, true),
                    input = z
                        .discriminatedUnion("action", [
                            z
                                .object({
                                    action: z.literal("preview"),
                                    revisionId: uuid,
                                    eventId: uuid,
                                })
                                .strict(),
                            z
                                .object({
                                    action: z.literal("publish"),
                                    version: z.number().int().positive(),
                                    revisionId: uuid,
                                    previewId: uuid,
                                    allowCustomerReplies: z.boolean(),
                                })
                                .strict(),
                            z
                                .object({
                                    action: z.enum(["disable", "enable"]),
                                    version: z.number().int().positive(),
                                })
                                .strict(),
                        ])
                        .parse(await jsonBody(req, 250000));
                if (input.action === "preview")
                    return simulateWorkflow(
                        who,
                        id,
                        input.revisionId,
                        input.eventId,
                    );
                if (input.action === "publish")
                    return publishWorkflow(who, id, input);
                if (input.action === "enable")
                    return enableWorkflow(who, id, input.version);
                return disableWorkflow(who, id, input.version);
            }),
    };
}
export function workflowEventsHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const workspaceId = ws.parse(
                    req.nextUrl.searchParams.get("workspaceId"),
                );
                return workflowEventPage(
                    await webhookActor(req, external, { workspaceId }),
                    workspaceId,
                    req.nextUrl.searchParams.has("before")
                        ? uuid.parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
    };
}
export function workflowRunsHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const id = uuid.parse((await c.params).id);
                return workflowRunPage(
                    await actor(req, external, id),
                    id,
                    req.nextUrl.searchParams.has("before")
                        ? uuid.parse(req.nextUrl.searchParams.get("before"))
                        : undefined,
                );
            }),
    };
}
export function workflowRunHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const params = await c.params,
                    id = uuid.parse(params.id);
                return workflowRunDetail(
                    await actor(req, external, id),
                    id,
                    uuid.parse(params.runId),
                );
            }),
        POST: (req: NextRequest, c: C) =>
            handleInbox(async () => {
                const params = await c.params,
                    id = uuid.parse(params.id),
                    input = z
                        .object({ action: z.enum(["cancel", "retry"]) })
                        .strict()
                        .parse(await jsonBody(req, 250000));
                return changeWorkflowRun(
                    await actor(req, external, id, true),
                    id,
                    uuid.parse(params.runId),
                    input.action,
                );
            }),
    };
}
