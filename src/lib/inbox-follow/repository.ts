import { and, eq } from "drizzle-orm";
import { db, inboxConversationFollowers as followers } from "@/lib/db";
import { requireCustomerChannel, type CustomerActor } from "@/lib/customer-access/access";
import { ownedConversation } from "@/lib/inbox/repository";

/** 내가 이 대화방을 팔로우하는지 */
export async function followState(actor: CustomerActor, id: string) {
    const chat = await ownedConversation(actor, id);
    const [row] = await db
        .select({ userId: followers.userId })
        .from(followers)
        .where(and(eq(followers.conversationId, chat.id), eq(followers.userId, actor.userId)));
    return { following: !!row };
}

/** 팔로우하기/그만두기 — 응대 권한이 있어야 팔로우할 수 있다 */
export async function setFollow(actor: CustomerActor, id: string, follow: boolean) {
    const chat = await ownedConversation(actor, id);
    if (follow) {
        await requireCustomerChannel(actor, chat.channelId, "respond");
        await db
            .insert(followers)
            .values({ conversationId: chat.id, userId: actor.userId })
            .onConflictDoNothing();
    } else
        await db
            .delete(followers)
            .where(and(eq(followers.conversationId, chat.id), eq(followers.userId, actor.userId)));
    return { following: follow };
}
