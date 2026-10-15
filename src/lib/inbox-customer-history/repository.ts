import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
    db,
    crmContacts,
    inboxChannels,
    inboxConversations as chats,
    inboxMessages as messages,
    inboxCustomerReads as reads,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { authenticatedCustomer, appendMessage } from "@/lib/inbox/repository";
import { InboxError } from "@/lib/inbox/errors";
import { fileOwner } from "@/lib/inbox/files";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { lockWorkflowWorkspace } from "@/lib/customer-workflows/repository";
import {
    customerThreadCreate,
    customerThreadRead,
    customerConversationCursor,
    parseCustomerConversationCursor,
} from "./rules";
const visible = (channelId: number, contactId: string) =>
    and(
        eq(chats.channelId, channelId),
        eq(chats.contactId, contactId),
        eq(chats.historyOnly, false),
        eq(chats.medium, "web"),
        isNull(chats.mergedIntoId),
    );
export async function customerConversationPage(
    key: string,
    token: string,
    before?: string,
    exec: DbExec = db,
) {
    const { channel, contact } = await authenticatedCustomer(key, token, exec),
        where = visible(channel.id, contact.id);
    const position = before ? parseCustomerConversationCursor(before) : null;
    const [cursorRow] = position
        ? await exec
              .select({ id: chats.id, at: chats.lastMessageAt })
              .from(chats)
              .where(and(where, eq(chats.id, position.id)))
        : [];
    if (before && !cursorRow)
        throw new InboxError("상담 목록 위치를 확인해주세요.", 404);
    const cursor = cursorRow
        ? { ...cursorRow, at: position?.at ?? cursorRow.at }
        : null;
    // Drizzle unqualifies SELECT columns on one-table queries, including nested SQL.
    const threadId = sql.raw('"inbox_conversations"."id"');
    // Use public message rows; staff notes and administrative previews cannot enter this contract.
    const rows = await exec
        .select({
            id: chats.id,
            status: chats.status,
            isCurrent: chats.isCurrent,
            lastMessageAt: chats.lastMessageAt,
            title: sql<string>`coalesce((select coalesce(nullif(left(m.body,120),''),'첨부파일 문의') from inbox_messages m where m.conversation_id=${threadId} and m.kind='customer' order by m.created_at,m.id limit 1),'문의')`,
            preview: sql<string>`coalesce((select coalesce(nullif(left(m.body,200),''),'파일 첨부') from inbox_messages m where m.conversation_id=${threadId} and m.kind<>'note' order by m.created_at desc,m.id desc limit 1),'')`,
            unread: sql<number>`(select count(*) from inbox_messages m left join inbox_customer_reads r on r.conversation_id=m.conversation_id and r.contact_id=${contact.id}::uuid where m.conversation_id=${threadId} and m.kind='reply' and (m.id>coalesce(r.last_message_id,0) or m.id=any(coalesce(r.merged_unread_ids,'{}'::integer[]))))`.mapWith(
                Number,
            ),
        })
        .from(chats)
        .where(
            and(
                where,
                sql`exists(select 1 from inbox_messages m where m.conversation_id=${threadId} and m.kind<>'note')`,
                cursor
                    ? or(
                          lt(chats.lastMessageAt, cursor.at),
                          and(
                              eq(chats.lastMessageAt, cursor.at),
                              lt(chats.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(chats.lastMessageAt), desc(chats.id))
        .limit(51);
    const [total] = await exec
        .select({ unread: sql<number>`count(*)`.mapWith(Number) })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.conversationId))
        .leftJoin(
            reads,
            and(
                eq(reads.conversationId, chats.id),
                eq(reads.contactId, contact.id),
            ),
        )
        .where(
            and(
                where,
                eq(messages.kind, "reply"),
                sql`(${messages.id}>coalesce(${reads.lastMessageId},0) or ${messages.id}=any(coalesce(${reads.mergedUnreadIds},'{}'::integer[])))`,
            ),
        );
    return {
        rows: rows.slice(0, 50),
        hasMore: rows.length > 50,
        nextBefore:
            rows.length > 50
                ? customerConversationCursor(rows[49].lastMessageAt, rows[49].id)
                : null,
        unreadCount: total.unread,
    };
}
export async function createCustomerConversation(
    key: string,
    token: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = customerThreadCreate.parse(raw),
        verified = await authenticatedCustomer(key, token, exec);
    return exec.transaction(async (tx) => {
        // Match identity linking and workflow execution. FK checks performed
        // while enqueuing events also acquire locks on this workspace.
        await lockWorkflowWorkspace(
            verified.channel.orgId,
            verified.channel.workspaceId,
            tx,
        );
        const [channel] = await tx
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.id, verified.channel.id))
            .for("update");
        if (!channel?.enabled)
            throw new InboxError("지금은 상담창을 이용할 수 없습니다.", 404);
        const [contact] = await tx
            .select()
            .from(crmContacts)
            .where(
                and(
                    eq(crmContacts.id, verified.contact.id),
                    eq(crmContacts.workspaceId, channel.workspaceId),
                    eq(crmContacts.orgId, channel.orgId),
                ),
            )
            .for("update");
        if (!contact)
            throw new InboxError("회원 상담 고객을 찾을 수 없습니다.", 401);
        const [duplicate] = await tx
            .select()
            .from(chats)
            .where(
                and(
                    visible(channel.id, contact.id),
                    eq(chats.customerCreateKey, input.clientId),
                ),
            );
        let chat = duplicate;
        if (!chat) {
            await tx
                .update(chats)
                .set({ isCurrent: false })
                .where(
                    and(
                        visible(channel.id, contact.id),
                        eq(chats.isCurrent, true),
                    ),
                );
            [chat] = await tx
                .insert(chats)
                .values({
                    channelId: channel.id,
                    orgId: channel.orgId,
                    contactId: contact.id,
                    customerCreateKey: input.clientId,
                    tokenHash: createHash("sha256")
                        .update(randomBytes(32))
                        .digest("hex"),
                    name: contact.name,
                    email: contact.email,
                    recordId: contact.recordId,
                })
                .returning();
            await enqueuePlatformEvent(tx, {
                orgId: channel.orgId,
                workspaceId: channel.workspaceId,
                key: `conversation:${chat.id}:created`,
                type: "conversation.created",
                data: {
                    conversationId: chat.id,
                    channelId: channel.id,
                    contactId: contact.id,
                    name: contact.name,
                    email: contact.email,
                },
            });
        }
        const message = await appendMessage(
            tx,
            chat.id,
            { ...input, kind: "customer", authorName: contact.name },
            {
                orgId: channel.orgId,
                channelId: channel.id,
                conversationId: chat.id,
                ownerKey: fileOwner(`member:${channel.id}:${contact.id}`),
                publicOnly: true,
            },
        );
        return {
            conversationId: chat.id,
            id: message.id,
            clientId: message.clientId,
        };
    });
}
export async function markCustomerConversationRead(
    key: string,
    token: string,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = customerThreadRead.parse(raw),
        { channel, contact } = await authenticatedCustomer(key, token, exec);
    return exec.transaction(async (tx) => {
        // The read marker's contact FK obtains a KEY SHARE lock. Take it before
        // the conversation, matching create/link contact-before-thread order.
        await tx
            .select({ id: crmContacts.id })
            .from(crmContacts)
            .where(eq(crmContacts.id, contact.id))
            .for("share");
        const [chat] = await tx
            .select({ id: chats.id })
            .from(chats)
            .where(and(visible(channel.id, contact.id), eq(chats.id, id)))
            .for("update");
        if (!chat) throw new InboxError("이 상담을 찾을 수 없습니다.", 404);
        const [seen] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(
                and(
                    eq(messages.id, input.lastMessageId),
                    eq(messages.conversationId, id),
                    sql`${messages.kind}<>'note'`,
                ),
            );
        if (!seen)
            throw new InboxError("확인한 메시지를 다시 불러와주세요.", 409);
        const [saved] = await tx
            .insert(reads)
            .values({
                conversationId: id,
                contactId: contact.id,
                lastMessageId: seen.id,
            })
            .onConflictDoUpdate({
                target: [reads.conversationId, reads.contactId],
                set: {
                    lastMessageId: sql`greatest(${reads.lastMessageId},${seen.id})`,
                    // A delayed pre-merge read (or a legacy client) cannot consume
                    // replies which were not present in the detail it displayed.
                    mergedUnreadIds: sql`case when ${input.readRevision ?? null}::integer=${reads.readRevision} then array(select moved_id from unnest(${reads.mergedUnreadIds}) as moved_id where moved_id>${seen.id}) else ${reads.mergedUnreadIds} end`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                lastMessageId: reads.lastMessageId,
                readRevision: reads.readRevision,
                mergedUnreadIds: reads.mergedUnreadIds,
            });
        const [count] = await tx
            .select({ unread: sql<number>`count(*)`.mapWith(Number) })
            .from(messages)
            .innerJoin(
                reads,
                and(
                    eq(reads.conversationId, messages.conversationId),
                    eq(reads.contactId, contact.id),
                ),
            )
            .where(
                and(
                    eq(messages.conversationId, id),
                    eq(messages.kind, "reply"),
                    sql`(${messages.id}>${reads.lastMessageId} or ${messages.id}=any(${reads.mergedUnreadIds}))`,
                ),
            );
        return {
            lastMessageId: saved.lastMessageId,
            readRevision: saved.readRevision,
            unread: count.unread,
        };
    });
}
