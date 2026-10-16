import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import {
    authenticatePlatform,
    authorizeChannel,
    authorizeConversation,
} from "@/lib/customer-platform/external-auth";
import { replyGuardPage, setReplyGuard, updateReplyLease } from "./repository";
import { replyGuardSettingsInput, replyLeaseInput } from "./rules";
export function replyGuardHandlers(external: boolean) {
    return {
        GET: (req: NextRequest) =>
            handleInbox(async () => {
                const q = req.nextUrl.searchParams,
                    channelId = z.coerce
                        .number()
                        .int()
                        .positive()
                        .parse(q.get("channelId")),
                    conversationId = q.has("conversationId")
                        ? z.string().uuid().parse(q.get("conversationId"))
                        : undefined,
                    sessionId = q.has("sessionId")
                        ? z.string().uuid().parse(q.get("sessionId"))
                        : undefined;
                const ctx = external ? await authenticatePlatform(req) : null;
                if (ctx) await authorizeChannel(ctx, channelId, "read");
                return replyGuardPage(
                    ctx?.actor ?? inboxActor(req),
                    channelId,
                    conversationId,
                    sessionId,
                );
            }),
        PATCH: (req: NextRequest) =>
            handleInbox(async () => {
                const input = replyGuardSettingsInput.parse(
                        await jsonBody(req),
                    ),
                    ctx = external ? await authenticatePlatform(req) : null;
                if (ctx) await authorizeChannel(ctx, input.channelId, "update");
                return setReplyGuard(ctx?.actor ?? inboxActor(req), input);
            }),
        POST: (req: NextRequest) =>
            handleInbox(async () => {
                const input = replyLeaseInput.parse(await jsonBody(req)),
                    ctx = external ? await authenticatePlatform(req) : null;
                if (ctx)
                    await authorizeConversation(
                        ctx,
                        input.conversationId,
                        "create",
                    );
                return updateReplyLease(ctx?.actor ?? inboxActor(req), input);
            }),
    };
}
