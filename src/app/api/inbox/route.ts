import { NextRequest } from "next/server";
import { z } from "zod";
import {
    bootstrapInbox,
    listConversations,
    conversationListPage,
    conversationCounts,
} from "@/lib/inbox/repository";
import { readConversationFilters } from "@/lib/inbox/rules";
import { handleInbox, inboxActor } from "@/lib/inbox/http";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const actor = inboxActor(req),
            value = req.nextUrl.searchParams.get("channelId");
        if (!value) return bootstrapInbox(actor);
        const channel = z.coerce.number().int().positive().parse(value);
        const before = req.nextUrl.searchParams.get("before");
        const cursor = before
            ? new Date(z.iso.datetime({ offset: true }).parse(before))
            : undefined;
        const beforeId = req.nextUrl.searchParams.get("beforeId")
            ? z.string().uuid().parse(req.nextUrl.searchParams.get("beforeId"))
            : undefined;
        const filters = readConversationFilters(req.nextUrl.searchParams);
        if (req.nextUrl.searchParams.get("view") === "counts")
            return conversationCounts(actor, channel, filters);
        if (req.nextUrl.searchParams.get("view") === "rows") {
            const rows = await listConversations(actor, channel, undefined, cursor, beforeId, filters);
            return { rows, hasMore: rows.length === 100 };
        }
        if (req.nextUrl.searchParams.get("view") === "list")
            return conversationListPage(
                actor,
                channel,
                filters,
                cursor,
                beforeId,
            );
        return listConversations(
            actor,
            channel,
            undefined,
            cursor,
            beforeId,
            filters,
        );
    });
}
