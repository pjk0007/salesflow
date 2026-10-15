import { and, eq, gt, lt, sql, type SQLWrapper } from "drizzle-orm";
import {
    db,
    users,
    inboxConversations as chats,
    inboxAgentAvailability as availability,
    inboxAgentSessions as sessions,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    requireCustomerChannel,
    customerAccessPredicate,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { openWorkload } from "@/lib/inbox-capacity/limits";
import {
    heartbeatInput,
    availabilityInput,
    PRESENCE_TTL_MS,
    TYPING_TTL_MS,
    visibleActivity,
} from "./rules";

async function conversation(
    actor: CustomerActor,
    channelId: number,
    id: string,
    exec: DbExec,
) {
    const [chat] = await exec
        .select()
        .from(chats)
        .where(
            and(
                eq(chats.id, id),
                eq(chats.orgId, actor.orgId),
                eq(chats.channelId, channelId),
                sql`${chats.mergedIntoId} IS NULL`,
            ),
        );
    if (!chat)
        throw new InboxError("이 상담창의 대화를 찾을 수 없습니다.", 404);
    return chat;
}
export const agentAvailablePredicate = (
    channelId: number,
    userId: string | SQLWrapper,
    now = new Date(),
) => sql`EXISTS (
    SELECT 1 FROM inbox_agent_availability iaa WHERE iaa.channel_id=${channelId} AND iaa.user_id=${userId}::uuid AND iaa.state='available'
    AND EXISTS (SELECT 1 FROM inbox_agent_sessions ias WHERE ias.channel_id=iaa.channel_id AND ias.user_id=iaa.user_id AND ias.expires_at>${now.toISOString()}::timestamptz))`;

export async function presencePage(
    actor: CustomerActor,
    channelId: number,
    conversationId: string | null = null,
    exec: DbExec = db,
    now = new Date(),
) {
    const channel = await requireCustomerChannel(
        actor,
        channelId,
        "read",
        exec,
    );
    if (conversationId)
        await conversation(actor, channelId, conversationId, exec);
    const people = await exec
        .select({
            id: users.id,
            name: users.name,
            openConversations: openWorkload(channelId, sql`${users}.id`),
            canRespond: sql<boolean>`${customerAccessPredicate(actor.orgId, sql`${users}.id`, sql`${channel.workspaceId}`, "respond")}`,
        })
        .from(users)
        .where(
            customerAccessPredicate(
                actor.orgId,
                users.id,
                sql`${channel.workspaceId}`,
            ),
        )
        .orderBy(users.name);
    const configs = await exec
        .select()
        .from(availability)
        .where(eq(availability.channelId, channelId));
    const active = await exec
        .select()
        .from(sessions)
        .where(
            and(eq(sessions.channelId, channelId), gt(sessions.expiresAt, now)),
        );
    const agents = people.map((p) => {
        const mine = active.filter((s) => s.userId === p.id),
            config = configs.find((c) => c.userId === p.id);
        const inChat = conversationId
            ? mine.filter((s) => s.conversationId === conversationId)
            : [];
        const activities = inChat.map((s) =>
            p.canRespond ? visibleActivity(s, now) : "viewing",
        );
        return {
            ...p,
            maxOpenConversations: config?.maxOpenConversations ?? null,
            online: !!mine.length,
            state:
                config?.state === "available"
                    ? ("available" as const)
                    : ("away" as const),
            activity: activities.includes("reply")
                ? ("reply" as const)
                : activities.includes("note")
                  ? ("note" as const)
                  : inChat.length
                    ? ("viewing" as const)
                    : null,
        };
    });
    const me = configs.find((c) => c.userId === actor.userId);
    return {
        agents,
        me: {
            state:
                me?.state === "available"
                    ? ("available" as const)
                    : ("away" as const),
            version: me?.version ?? 0,
        },
        serverTime: now.toISOString(),
    };
}
export async function setAvailability(
    actor: CustomerActor,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = availabilityInput.parse(raw, {
        error: () => "응대 상태 입력값을 확인해주세요.",
    });
    await requireCustomerChannel(actor, input.channelId, "respond", exec);
    return exec.transaction(async (tx) => {
        const where = and(
            eq(availability.channelId, input.channelId),
            eq(availability.userId, actor.userId),
        );
        const [current] = await tx
            .select()
            .from(availability)
            .where(where)
            .for("update");
        if ((current?.version ?? 0) !== input.version)
            throw new InboxError(
                "다른 창에서 응대 상태를 변경했습니다. 최신 상태를 확인해주세요.",
                409,
            );
        if (current?.state === input.state)
            return { state: current.state, version: current.version };
        const value = {
            state: input.state,
            version: input.version + 1,
            updatedAt: new Date(),
        };
        const [saved] = current
            ? await tx.update(availability).set(value).where(where).returning()
            : await tx
                  .insert(availability)
                  .values({
                      ...value,
                      channelId: input.channelId,
                      userId: actor.userId,
                  })
                  .onConflictDoNothing()
                  .returning();
        if (!saved)
            throw new InboxError(
                "다른 창에서 응대 상태를 변경했습니다. 최신 상태를 확인해주세요.",
                409,
            );
        return { state: saved.state, version: saved.version };
    });
}
export async function heartbeat(
    actor: CustomerActor,
    raw: unknown,
    exec: DbExec = db,
    now = new Date(),
) {
    const input = heartbeatInput.parse(raw, {
        error: () => "접속 상태 입력값을 확인해주세요.",
    });
    await requireCustomerChannel(
        actor,
        input.channelId,
        !input.leave && input.activity !== "viewing" ? "respond" : "read",
        exec,
    );
    if (input.conversationId && !input.leave) {
        const chat = await conversation(
            actor,
            input.channelId,
            input.conversationId,
            exec,
        );
        if (input.activity !== "viewing" && chat.historyOnly)
            throw new InboxError(
                "과거 상담에는 작성 상태를 표시할 수 없습니다.",
                409,
            );
    }
    return exec.transaction(async (tx) => {
        // 하루 지난 자기 세션만 정리한다. 최근 종료 표시는 지연 요청의 순서 검사에 남겨둔다.
        await tx
            .delete(sessions)
            .where(
                and(
                    eq(sessions.channelId, input.channelId),
                    eq(sessions.userId, actor.userId),
                    lt(sessions.expiresAt, new Date(now.getTime() - 86400000)),
                ),
            );
        const value = {
            sequence: input.sequence,
            conversationId: input.leave ? null : input.conversationId,
            activity: input.leave ? "viewing" : input.activity,
            typingUntil:
                !input.leave && input.activity !== "viewing"
                    ? new Date(now.getTime() + TYPING_TTL_MS)
                    : null,
            expiresAt: input.leave
                ? now
                : new Date(now.getTime() + PRESENCE_TTL_MS),
        };
        const changed = await tx
            .insert(sessions)
            .values({
                channelId: input.channelId,
                userId: actor.userId,
                sessionId: input.sessionId,
                ...value,
            })
            .onConflictDoUpdate({
                target: [
                    sessions.channelId,
                    sessions.userId,
                    sessions.sessionId,
                ],
                set: value,
                setWhere: lt(sessions.sequence, input.sequence),
            })
            .returning({ expiresAt: sessions.expiresAt });
        return { accepted: !!changed.length };
    });
}
