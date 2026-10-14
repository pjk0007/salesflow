import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, inboxConversations, inboxMessages } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JourneyEvent } from "@/components/journey/types";
export async function loadInboxJourney(
    orgId: string,
    recordIds: number[],
    exec: DbExec = db,
): Promise<JourneyEvent[]> {
    if (!recordIds.length) return [];
    const rows = await exec
        .select({
            at: inboxMessages.createdAt,
            kind: inboxMessages.kind,
            body: inboxMessages.body,
            author: inboxMessages.authorName,
            chatId: inboxConversations.id,
            channelId: inboxConversations.channelId,
        })
        .from(inboxMessages)
        .innerJoin(
            inboxConversations,
            eq(inboxConversations.id, inboxMessages.conversationId),
        )
        .where(
            and(
                eq(inboxConversations.orgId, orgId),
                inArray(inboxConversations.recordId, recordIds),
                ne(inboxMessages.kind, "note"),
            ),
        )
        .orderBy(asc(inboxMessages.createdAt));
    return rows.map((m) => ({
        at: m.at.toISOString(),
        source: "inbox",
        channel: "상담",
        type: `chat_${m.kind}`,
        label: `${m.kind === "customer" ? "고객 문의" : "상담 답변"}: ${m.body.slice(0, 80)}`,
        meta: {
            author: m.author,
            body: m.body,
            conversationId: m.chatId,
            channelId: m.channelId,
        },
    }));
}
