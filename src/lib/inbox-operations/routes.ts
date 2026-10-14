import { requireAdmin } from "@/lib/auth-admin";
import { InboxError } from "@/lib/inbox/errors";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody, inboxActor } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
import { supportActor } from "@/lib/customer-ai/http";
import {
    operationsChannel,
    operationsSettings,
    saveOperationsSettings,
    notificationsPage,
    readNotifications,
    conversationOperations,
} from "./repository";
import { operationsReport } from "./reports";
type Context = { params: Promise<{ id: string }> };
const channelId = z.coerce.number().int().positive();
async function channelActor(
    req: NextRequest,
    external: boolean,
    id: number,
    manage = false,
) {
    if (external) {
        const ctx = await authenticatePlatform(req),
            channel = await authorizeChannel(
                ctx,
                id,
                manage ? "update" : "read",
            );
        return supportActor(
            req,
            true,
            { workspaceId: channel.workspaceId },
            manage,
        );
    }
    const channel = await operationsChannel(inboxActor(req), id);
    return supportActor(
        req,
        false,
        { workspaceId: channel.workspaceId },
        manage,
    );
}
export function operationsSettingsHandlers(external: boolean) {
    return {
        GET: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = channelId.parse((await c.params).id);
                return operationsSettings(
                    await channelActor(req, external, id),
                    id,
                );
            }),
        POST: (req: NextRequest, c: Context) =>
            handleInbox(async () => {
                const id = channelId.parse((await c.params).id);
                return saveOperationsSettings(
                    await channelActor(req, external, id, true),
                    id,
                    await jsonBody(req, 50000),
                );
            }),
    };
}
export function operationsReportGet(external: boolean) {
    return (req: NextRequest) =>
        handleInbox(async () => {
            const q = req.nextUrl.searchParams,
                id = channelId.parse(q.get("channelId")),
                actor = await channelActor(req, external, id);
            return operationsReport(actor, id, {
                from: q.get("from") ?? "",
                to: q.get("to") ?? "",
                before: q.get("before") ?? undefined,
                medium: q.get("medium") ?? undefined,
            });
        });
}
export function operationsConversationGet(external: boolean) {
    return (req: NextRequest, c: Context) =>
        handleInbox(async () => {
            const id = z.uuid().parse((await c.params).id),
                actor = await supportActor(req, external, {
                    conversationId: id,
                });
            return conversationOperations(actor, id);
        });
}
export function operationsNotificationHandlers(external: boolean) {
    async function context(req: NextRequest) {
        const raw = req.nextUrl.searchParams.get("channelId"),
            id = raw ? channelId.parse(raw) : undefined;
        const actor = id
            ? await channelActor(req, external, id)
            : external
              ? await channelActor(req, true, channelId.parse(raw))
              : await (async () => {
                    inboxActor(req);
                    const result = await requireAdmin(req, "member");
                    if (!result.ok)
                        throw new InboxError(result.error, result.status);
                    return result.user;
                })();
        return { actor, id };
    }
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const { actor, id } = await context(req);
                return notificationsPage(actor, {
                    channelId: id,
                    before: req.nextUrl.searchParams.get("before") ?? undefined,
                    unread: req.nextUrl.searchParams.get("unread") === "true",
                });
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const { actor, id } = await context(req);
                if (external) {
                    const ctx = await authenticatePlatform(req);
                    await authorizeChannel(ctx, id!, "update");
                }
                return readNotifications(actor, await jsonBody(req), id);
            }),
    };
}
