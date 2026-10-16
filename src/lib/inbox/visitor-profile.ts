import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, inboxChannels, inboxConversations as chats } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { publicChannel } from "./repository";
import { InboxError } from "./errors";
import { appendInboxAudit, type AuditChanges } from "./audit";

const inputSchema = z
    .object({
        action: z.literal("profile"),
        name: z.string().trim().min(1).max(100),
        email: z.union([z.email().max(254), z.literal("")]).optional(),
    })
    .strict();

/** A typed profile only updates the current anonymous conversation, never a CRM identity. */
export async function updateVisitorProfile(
    key: string,
    token: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = inputSchema.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new InboxError(
            "비회원 상담에서만 입력 정보를 바꿀 수 있습니다.",
            401,
        );
    return exec.transaction(async (tx) => {
        const channel = await publicChannel(key, tx);
        const [live] = await tx
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.id, channel.id))
            .for("update");
        if (!live?.enabled)
            throw new InboxError("지금은 상담창을 이용할 수 없습니다.", 404);
        const [chat] = await tx
            .select()
            .from(chats)
            .where(
                and(
                    eq(chats.channelId, channel.id),
                    eq(
                        chats.tokenHash,
                        createHash("sha256").update(token).digest("hex"),
                    ),
                    isNull(chats.contactId),
                    isNull(chats.mergedIntoId),
                    isNull(chats.identifiedAt),
                    eq(chats.historyOnly, false),
                    eq(chats.medium, "web"),
                ),
            )
            .for("update");
        if (!chat) throw new InboxError("상담 세션을 확인해주세요.", 401);
        const email =
            input.email === undefined ? chat.email : input.email || null;
        const changes: AuditChanges = {};
        if (chat.name !== input.name)
            changes.name = { before: chat.name, after: input.name };
        if (chat.email !== email)
            changes.email = { before: chat.email, after: email };
        if (Object.keys(changes).length) {
            await tx
                .update(chats)
                .set({
                    name: input.name,
                    email,
                    version: sql`${chats.version}+1`,
                })
                .where(eq(chats.id, chat.id));
            await appendInboxAudit(tx, {
                orgId: channel.orgId,
                channelId: channel.id,
                conversationId: chat.id,
                actorId: null,
                actorName: input.name,
                action: "visitor.profile.updated",
                changes,
            });
        }
        return { name: input.name, email, identified: false as const };
    });
}
