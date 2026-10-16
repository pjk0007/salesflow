import { and, eq, inArray, sql } from "drizzle-orm";
import {
    inboxMessageMentions as mentions,
    inboxNotifications as notices,
    inboxChannels,
    inboxConversations,
    organizationMembers,
    users,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { customerAccessPredicate } from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { mentionIdsInput, sameMentionIds } from "./rules";
import {
    requireCustomerChannel,
    type CustomerActor,
} from "@/lib/customer-access/access";
export async function mentionTeammates(
    actor: CustomerActor,
    channelId: number,
    exec: DbExec,
) {
    const channel = await requireCustomerChannel(
        actor,
        channelId,
        "read",
        exec,
    );
    return exec
        .select({ id: users.id, name: users.name })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, actor.orgId),
                eq(users.isActive, 1),
                customerAccessPredicate(
                    actor.orgId,
                    users.id,
                    sql`${channel.workspaceId}`,
                    "read",
                ),
            ),
        )
        .orderBy(users.name, users.id);
}
type Chat = { id: string; orgId: string; channelId: number };
export async function readMessageMentions(exec: DbExec, messageIds: number[]) {
    if (!messageIds.length) return [];
    return exec
        .select({
            messageId: mentions.messageId,
            userId: mentions.userId,
            name: mentions.name,
        })
        .from(mentions)
        .where(inArray(mentions.messageId, messageIds))
        .orderBy(mentions.messageId, mentions.name, mentions.userId);
}
export async function assertMentionRetry(
    exec: DbExec,
    messageId: number,
    ids: string[],
) {
    const stored = await readMessageMentions(exec, [messageId]);
    if (
        !sameMentionIds(
            stored.map((m) => m.userId),
            ids,
        )
    )
        throw new InboxError(
            "같은 메시지 번호의 멘션 대상이 변경됐습니다.",
            409,
        );
}
export async function saveMessageMentions(
    exec: DbExec,
    chat: Chat,
    message: { id: number; authorName: string; createdAt: Date; body: string },
    raw: string[],
) {
    const ids = mentionIdsInput.parse(raw);
    if (!ids.length) return [];
    const people = await exec
        .select({ id: users.id, name: users.name })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, chat.orgId),
                inArray(users.id, ids),
                eq(users.isActive, 1),
                customerAccessPredicate(
                    chat.orgId,
                    users.id,
                    sql`(SELECT workspace_id FROM ${inboxChannels} WHERE id=${chat.channelId} AND org_id=${chat.orgId})`,
                    "read",
                ),
            ),
        );
    if (people.length !== ids.length)
        throw new InboxError(
            "멘션할 팀원의 사업 접근 권한이 변경됐습니다. 대상을 다시 확인해주세요.",
            409,
        );
    await exec.insert(mentions).values(
        people.map((p) => ({
            messageId: message.id,
            userId: p.id,
            name: p.name.slice(0, 100),
            orgId: chat.orgId,
            channelId: chat.channelId,
            conversationId: chat.id,
            createdAt: message.createdAt,
        })),
    );
    await exec
        .insert(notices)
        .values(
            people.map((p) => ({
                orgId: chat.orgId,
                channelId: chat.channelId,
                conversationId: chat.id,
                userId: p.id,
                type: "mentioned",
                messageId: message.id,
                eventKey: `mention:${message.id}`,
                preview:
                    `${message.authorName}: ${message.body || "첨부 메모"}`.slice(
                        0,
                        250,
                    ),
                createdAt: message.createdAt,
            })),
        )
        .onConflictDoNothing();
    return people.map((p) => ({ userId: p.id, name: p.name.slice(0, 100) }));
}
export const mentionedConversation = (userId: string) =>
    sql`EXISTS (SELECT 1 FROM ${mentions} WHERE ${mentions.conversationId}=${inboxConversations.id} AND ${mentions.userId}=${userId})`;
export async function moveConversationMentions(
    exec: DbExec,
    chat: Chat,
    sourceId: string,
) {
    const scope = and(
        eq(mentions.orgId, chat.orgId),
        eq(mentions.channelId, chat.channelId),
        eq(mentions.conversationId, sourceId),
    );
    await exec.update(mentions).set({ conversationId: chat.id }).where(scope);
    await exec
        .update(notices)
        .set({ conversationId: chat.id })
        .where(
            and(
                eq(notices.orgId, chat.orgId),
                eq(notices.channelId, chat.channelId),
                eq(notices.conversationId, sourceId),
                eq(notices.type, "mentioned"),
            ),
        );
}
