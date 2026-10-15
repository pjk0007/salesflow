import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
    db,
    inboxConversations,
    inboxMessages,
    inboxAttachments,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JourneyEvent } from "@/components/journey/types";
export async function loadInboxJourney(
    orgId: string,
    recordIds: number[],
    exec: DbExec = db,
    contactIds: string[] = [],
): Promise<JourneyEvent[]> {
    if (!recordIds.length && !contactIds.length) return [];
    const rows = await exec
        .select({
            at: inboxMessages.createdAt,
            kind: inboxMessages.kind,
            body: sql<string>`coalesce(nullif(${inboxMessages.body}, ''), (SELECT '파일: ' || string_agg(${inboxAttachments.fileName}, ', ' ORDER BY ${inboxAttachments.createdAt}, ${inboxAttachments.id}) FROM ${inboxAttachments} WHERE ${inboxAttachments.messageId} = ${inboxMessages.id}), '파일')`,
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
                or(recordIds.length ? inArray(inboxConversations.recordId, recordIds) : undefined,
                    contactIds.length ? inArray(inboxConversations.contactId, contactIds) : undefined),
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
