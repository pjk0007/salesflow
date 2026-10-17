import { and, eq, desc, gte } from "drizzle-orm";
import {
    customerReplyContacts as contacts,
    customerReplyNotifications as notices,
    inboxMessages as messages,
} from "@/lib/db";
import { notificationWorkerEnabled } from "./rules";
import type { DbExec } from "@/lib/db/tx";
export async function queueCustomerReplyNotice(
    exec: DbExec,
    chat: { id: string; medium: string; historyOnly: boolean },
    message: { id: number; kind: string; createdAt: Date },
) {
    if (!notificationWorkerEnabled()) return;
    if (message.kind !== "reply" || chat.medium !== "web" || chat.historyOnly)
        return;
    const [contact] = await exec
        .select()
        .from(contacts)
        .where(
            and(
                eq(contacts.conversationId, chat.id),
                eq(contacts.notifyEmail, true),
            ),
        );
    if (!contact?.verifiedAt || !contact.consentAt || !contact.email) return;
    await exec
        .insert(notices)
        .values({
            conversationId: chat.id,
            messageId: message.id,
            contactVersion: contact.version,
            dueAt: new Date(message.createdAt.getTime() + 120000),
        })
        .onConflictDoNothing();
}
export async function queueLatestCustomerReply(
    exec: DbExec,
    chat: { id: string; medium: string; historyOnly: boolean },
    now = new Date(),
) {
    const [reply] = await exec
        .select()
        .from(messages)
        .where(
            and(
                eq(messages.conversationId, chat.id),
                eq(messages.kind, "reply"),
                gte(messages.createdAt, new Date(now.getTime() - 86400000)),
            ),
        )
        .orderBy(desc(messages.id))
        .limit(1);
    if (reply) await queueCustomerReplyNotice(exec, chat, reply);
}
