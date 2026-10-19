import { and, eq, isNull } from "drizzle-orm";
import { inboxMessages, inboxConversations, inboxChannels, crmContacts, inboxChatAlertDeliveries } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { chatAlertRoutes, routeFingerprint } from "./config";

// Called inside the source message transaction. HTTP is handled only after commit by the worker.
export async function enqueueInboxChatAlert(exec: DbExec, event: {
    type: string; orgId: string; workspaceId: number;
    payload: { data: Record<string, unknown> };
}) {
    const routes = chatAlertRoutes();
    if (event.type !== "message.created" || !routes.some(route => route.orgId === event.orgId && route.workspaceId === event.workspaceId)) return;
    const raw = event.payload.data.message as { id?: unknown } | undefined;
    if (!Number.isSafeInteger(raw?.id)) return;
    const [row] = await exec.select({ message: inboxMessages, chat: inboxConversations, channel: inboxChannels, internal: crmContacts.isInternal })
        .from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id))
        .innerJoin(inboxChannels, eq(inboxConversations.channelId, inboxChannels.id))
        .leftJoin(crmContacts, eq(inboxConversations.contactId, crmContacts.id))
        .where(and(eq(inboxMessages.id, raw!.id as number), eq(inboxMessages.kind, "customer"),
            eq(inboxConversations.orgId, event.orgId), eq(inboxChannels.orgId, event.orgId),
            eq(inboxChannels.workspaceId, event.workspaceId), eq(inboxConversations.historyOnly, false), isNull(inboxConversations.mergedIntoId)));
    if (!row || !row.channel.enabled || row.internal || row.message.importMetadata || row.message.originConversationId) return;
    const route = routes.find(route => route.orgId === row.chat.orgId && route.workspaceId === row.channel.workspaceId && route.channelId === row.chat.channelId);
    if (route) await exec.insert(inboxChatAlertDeliveries).values({ messageId: row.message.id, routeHash: routeFingerprint(route) }).onConflictDoNothing();
}
