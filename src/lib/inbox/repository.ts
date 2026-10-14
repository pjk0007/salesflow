import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import {
    db,
    inboxChannels,
    inboxConversations,
    inboxMessages,
    inboxReads,
    organizationMembers,
    users,
    workspaces,
    records,
    partitions,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import {
    channelInput,
    messageInput,
    patchInput,
    replyInput,
    safePageUrl,
    sessionInput,
} from "./rules";

export class InboxError extends Error {
    constructor(
        message: string,
        public status = 400,
    ) {
        super(message);
    }
}
type Actor = Pick<JWTPayload, "orgId" | "userId" | "name" | "role">;
const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
const conversationColumns = {
    id: inboxConversations.id,
    channelId: inboxConversations.channelId,
    name: inboxConversations.name,
    email: inboxConversations.email,
    pageUrl: inboxConversations.pageUrl,
    status: inboxConversations.status,
    assigneeId: inboxConversations.assigneeId,
    recordId: inboxConversations.recordId,
    tags: inboxConversations.tags,
    priority: inboxConversations.priority,
    preview: inboxConversations.preview,
    lastMessageAt: inboxConversations.lastMessageAt,
    customerSeq: inboxConversations.customerSeq,
};
export async function bootstrapInbox(actor: Actor, exec: DbExec = db) {
    const [channels, members, spaces] = await Promise.all([
        exec
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.orgId, actor.orgId))
            .orderBy(inboxChannels.id),
        exec
            .select({ id: users.id, name: users.name })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
                and(
                    eq(organizationMembers.organizationId, actor.orgId),
                    eq(users.isActive, 1),
                ),
            ),
        exec
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.orgId, actor.orgId)),
    ]);
    return { channels, members, workspaces: spaces };
}
export async function saveChannel(
    actor: Actor,
    raw: unknown,
    exec: DbExec = db,
) {
    if (actor.role === "member")
        throw new InboxError("관리자만 상담창을 설정할 수 있습니다.", 403);
    const input = channelInput.parse(raw);
    const [space] = await exec
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
            and(
                eq(workspaces.id, input.workspaceId),
                eq(workspaces.orgId, actor.orgId),
            ),
        );
    if (!space) throw new InboxError("워크스페이스를 찾을 수 없습니다.", 404);
    const [channel] = await exec
        .insert(inboxChannels)
        .values({
            ...input,
            orgId: actor.orgId,
            publicKey: randomBytes(24).toString("hex"),
        })
        .onConflictDoUpdate({ target: inboxChannels.workspaceId, set: input })
        .returning();
    return channel;
}
export async function listConversations(
    actor: Actor,
    channelId: number,
    exec: DbExec = db,
    before?: Date,
    beforeId?: string,
) {
    return exec
        .select({
            ...conversationColumns,
            unread: sql<boolean>`${inboxConversations.customerSeq} > coalesce(${inboxReads.customerSeq},0)`,
        })
        .from(inboxConversations)
        .leftJoin(
            inboxReads,
            and(
                eq(inboxReads.conversationId, inboxConversations.id),
                eq(inboxReads.userId, actor.userId),
            ),
        )
        .where(
            and(
                eq(inboxConversations.orgId, actor.orgId),
                eq(inboxConversations.channelId, channelId),
                before
                    ? or(
                          lt(inboxConversations.lastMessageAt, before),
                          beforeId
                              ? and(
                                    eq(
                                        inboxConversations.lastMessageAt,
                                        before,
                                    ),
                                    lt(inboxConversations.id, beforeId),
                                )
                              : undefined,
                      )
                    : undefined,
            ),
        )
        .orderBy(
            desc(inboxConversations.lastMessageAt),
            desc(inboxConversations.id),
        )
        .limit(100);
}
async function ownedConversation(actor: Actor, id: string, exec: DbExec) {
    const [chat] = await exec
        .select(conversationColumns)
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.id, id),
                eq(inboxConversations.orgId, actor.orgId),
            ),
        );
    if (!chat) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    return chat;
}
async function readMessages(
    id: string,
    exec: DbExec,
    publicOnly: boolean,
    before?: number,
) {
    const messages = await exec
        .select()
        .from(inboxMessages)
        .where(
            and(
                eq(inboxMessages.conversationId, id),
                publicOnly ? sql`${inboxMessages.kind} <> 'note'` : undefined,
                before ? lt(inboxMessages.id, before) : undefined,
            ),
        )
        .orderBy(desc(inboxMessages.id))
        .limit(100);
    return { messages: messages.reverse(), hasOlder: messages.length === 100 };
}
export async function conversationDetail(
    actor: Actor,
    id: string,
    exec: DbExec = db,
    before?: number,
) {
    const conversation = await ownedConversation(actor, id, exec);
    return { conversation, ...(await readMessages(id, exec, false, before)) };
}
export async function patchConversation(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = patchInput.parse(raw);
    await ownedConversation(actor, id, exec);
    if (input.assigneeId) {
        const [member] = await exec
            .select({ id: users.id })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(
                and(
                    eq(organizationMembers.organizationId, actor.orgId),
                    eq(users.id, input.assigneeId),
                    eq(users.isActive, 1),
                ),
            );
        if (!member)
            throw new InboxError("이 조직의 활성 팀원을 선택해주세요.");
    }
    if (input.recordId) {
        const [record] = await exec
            .select({ id: records.id })
            .from(records)
            .innerJoin(partitions, eq(partitions.id, records.partitionId))
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .innerJoin(inboxConversations, eq(inboxConversations.id, id))
            .innerJoin(
                inboxChannels,
                eq(inboxChannels.id, inboxConversations.channelId),
            )
            .where(
                and(
                    eq(records.id, input.recordId),
                    eq(records.orgId, actor.orgId),
                    eq(workspaces.id, inboxChannels.workspaceId),
                ),
            );
        if (!record)
            throw new InboxError(
                "이 상담 채널과 같은 워크스페이스의 CRM 고객을 선택해주세요.",
            );
    }
    if (!Object.keys(input).length)
        throw new InboxError("변경할 내용을 선택해주세요.");
    const [updated] = await exec
        .update(inboxConversations)
        .set({
            ...input,
            ...(input.tags ? { tags: [...new Set(input.tags)] } : {}),
        })
        .where(
            and(
                eq(inboxConversations.id, id),
                eq(inboxConversations.orgId, actor.orgId),
            ),
        )
        .returning(conversationColumns);
    return updated;
}
export async function markRead(
    actor: Actor,
    id: string,
    seenSeq: number,
    exec: DbExec = db,
) {
    const chat = await ownedConversation(actor, id, exec);
    const seen = Math.min(chat.customerSeq, Math.max(0, seenSeq));
    await exec
        .insert(inboxReads)
        .values({ conversationId: id, userId: actor.userId, customerSeq: seen })
        .onConflictDoUpdate({
            target: [inboxReads.conversationId, inboxReads.userId],
            set: {
                customerSeq: sql`greatest(${inboxReads.customerSeq},${seen})`,
            },
        });
}
async function appendMessage(
    exec: DbExec,
    id: string,
    message: {
        clientId: string;
        kind: "reply" | "note" | "customer";
        body: string;
        authorId?: string;
        authorName: string;
    },
) {
    return exec.transaction(async (tx) => {
        // 상담마다 직렬화: 중복 제출과 종료 후 재문의가 겹쳐도 순서/미확인 수를 보존한다.
        const [locked] = await tx
            .select({
                id: inboxConversations.id,
                status: inboxConversations.status,
            })
            .from(inboxConversations)
            .where(eq(inboxConversations.id, id))
            .for("update");
        const [duplicate] = await tx
            .select()
            .from(inboxMessages)
            .where(
                and(
                    eq(inboxMessages.conversationId, id),
                    eq(inboxMessages.clientId, message.clientId),
                ),
            );
        if (duplicate) {
            if (
                duplicate.kind !== message.kind ||
                duplicate.body !== message.body
            )
                throw new InboxError("이미 처리된 메시지 번호입니다.", 409);
            return duplicate;
        }
        if (message.kind === "reply" && locked.status === "closed")
            throw new InboxError("상담을 다시 연 뒤 답변해주세요.");
        if (message.kind === "customer") {
            const recent = await tx
                .select({ id: inboxMessages.id })
                .from(inboxMessages)
                .where(
                    and(
                        eq(inboxMessages.conversationId, id),
                        eq(inboxMessages.kind, "customer"),
                        gt(
                            inboxMessages.createdAt,
                            new Date(Date.now() - 60000),
                        ),
                    ),
                )
                .limit(20);
            if (recent.length >= 20)
                throw new InboxError(
                    "메시지가 많습니다. 잠시 후 다시 보내주세요.",
                    429,
                );
        }
        const [inserted] = await tx
            .insert(inboxMessages)
            .values({ ...message, conversationId: id })
            .onConflictDoNothing({
                target: [inboxMessages.conversationId, inboxMessages.clientId],
            })
            .returning();
        if (!inserted) {
            const [existing] = await tx
                .select()
                .from(inboxMessages)
                .where(
                    and(
                        eq(inboxMessages.conversationId, id),
                        eq(inboxMessages.clientId, message.clientId),
                    ),
                );
            if (
                existing.kind !== message.kind ||
                existing.body !== message.body
            )
                throw new InboxError("이미 처리된 메시지 번호입니다.", 409);
            return existing;
        }
        if (message.kind !== "note") {
            await tx
                .update(inboxConversations)
                .set({
                    preview: message.body.slice(0, 200),
                    lastMessageAt: inserted.createdAt,
                    ...(message.kind === "customer"
                        ? {
                              status: "open",
                              customerSeq: sql`${inboxConversations.customerSeq} + 1`,
                          }
                        : {}),
                })
                .where(eq(inboxConversations.id, id));
        }
        return inserted;
    });
}
export async function sendAgentMessage(
    actor: Actor,
    id: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = replyInput.parse(raw);
    await ownedConversation(actor, id, exec);
    return appendMessage(exec, id, {
        ...input,
        authorId: actor.userId,
        authorName: actor.name,
    });
}
export async function publicChannel(key: string, exec: DbExec = db) {
    const [channel] = await exec
        .select()
        .from(inboxChannels)
        .where(
            and(
                eq(inboxChannels.publicKey, key),
                eq(inboxChannels.enabled, true),
            ),
        );
    if (!channel)
        throw new InboxError("지금은 상담창을 이용할 수 없습니다.", 404);
    return channel;
}
export async function startVisitorSession(
    key: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = sessionInput.parse(raw),
        channel = await publicChannel(key, exec);
    const token = input.token ?? randomBytes(32).toString("hex");
    if (input.token) {
        const [chat] = await exec
            .select({ id: inboxConversations.id })
            .from(inboxConversations)
            .where(
                and(
                    eq(inboxConversations.channelId, channel.id),
                    eq(inboxConversations.tokenHash, hash(token)),
                ),
            );
        if (!chat)
            throw new InboxError(
                "상담 세션이 만료되었습니다. 새 문의를 시작해주세요.",
                401,
            );
        return { token, id: chat.id };
    }
    const [chat] = await exec
        .insert(inboxConversations)
        .values({
            channelId: channel.id,
            orgId: channel.orgId,
            tokenHash: hash(token),
            name: input.name,
            email: input.email || null,
            pageUrl: safePageUrl(input.pageUrl, channel.allowedOrigins),
        })
        .returning({ id: inboxConversations.id });
    return { token, id: chat.id };
}
async function visitorConversation(key: string, token: string, exec: DbExec) {
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new InboxError("상담 세션을 확인해주세요.", 401);
    const channel = await publicChannel(key, exec);
    const [chat] = await exec
        .select({
            id: inboxConversations.id,
            name: inboxConversations.name,
            status: inboxConversations.status,
        })
        .from(inboxConversations)
        .where(
            and(
                eq(inboxConversations.channelId, channel.id),
                eq(inboxConversations.tokenHash, hash(token)),
            ),
        );
    if (!chat) throw new InboxError("상담 세션을 확인해주세요.", 401);
    return chat;
}
export async function visitorDetail(
    key: string,
    token: string,
    exec: DbExec = db,
    before?: number,
) {
    const chat = await visitorConversation(key, token, exec);
    const result = await readMessages(chat.id, exec, true, before);
    // 방문자에게는 직원 식별자·내부 메모·CRM 연결 정보를 내보내지 않는다.
    return {
        status: chat.status,
        hasOlder: result.hasOlder,
        messages: result.messages.map((m) => ({
            id: m.id,
            clientId: m.clientId,
            kind: m.kind,
            body: m.body,
            authorName: m.authorName,
            createdAt: m.createdAt,
        })),
    };
}
export async function sendVisitorMessage(
    key: string,
    token: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = messageInput.parse(raw),
        chat = await visitorConversation(key, token, exec);
    const result = await appendMessage(exec, chat.id, {
        ...input,
        kind: "customer",
        authorName: chat.name,
    });
    return { id: result.id, clientId: result.clientId };
}
