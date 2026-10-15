import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    crmContacts,
    inboxChannels,
    inboxConversations as chats,
    inboxMessages as messages,
    inboxAttachments as files,
    customerAiJobs,
    customerWorkflowRuns as runs,
    inboxCustomerReads,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { authenticatedCustomer } from "./repository";
import { InboxError } from "./errors";
import { appendInboxAudit } from "./audit";
import { appendActivity } from "@/lib/customer-platform/activities";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { lockWorkflowWorkspace } from "@/lib/customer-workflows/repository";
import { moveConversationMentions } from "@/lib/inbox-collaboration/mentions";

const inputSchema = z
    .object({
        action: z.literal("identify"),
        anonymousToken: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();

/** Only the login flow may supply both proofs. Never match a typed email. */
export async function linkVisitorIdentity(
    key: string,
    identityToken: string,
    raw: unknown,
    exec: DbExec = db,
) {
    const input = inputSchema.parse(raw);
    const { channel, contact } = await authenticatedCustomer(
        key,
        identityToken,
        exec,
    );
    return exec.transaction(async (tx) => {
        // Match the workflow worker lock order; uploads also lock the channel.
        await lockWorkflowWorkspace(channel.orgId, channel.workspaceId, tx);
        const [liveChannel] = await tx
            .select()
            .from(inboxChannels)
            .where(eq(inboxChannels.id, channel.id))
            .for("update");
        if (!liveChannel.enabled)
            throw new InboxError("지금은 상담창을 이용할 수 없습니다.", 404);
        const [member] = await tx
            .select()
            .from(crmContacts)
            .where(
                and(
                    eq(crmContacts.id, contact.id),
                    eq(crmContacts.workspaceId, channel.workspaceId),
                    eq(crmContacts.orgId, channel.orgId),
                ),
            )
            .for("update");
        if (!member)
            throw new InboxError("회원 상담 고객을 찾을 수 없습니다.", 401);
        const tokenHash = createHash("sha256")
            .update(input.anonymousToken)
            .digest("hex");
        const [hint] = await tx
            .select()
            .from(chats)
            .where(
                and(
                    eq(chats.channelId, channel.id),
                    eq(chats.orgId, channel.orgId),
                    eq(chats.tokenHash, tokenHash),
                ),
            );
        if (!hint)
            throw new InboxError("연결할 비회원 상담을 확인해주세요.", 401);
        if (hint.historyOnly || hint.medium !== "web")
            throw new InboxError(
                "과거 상담 기록은 회원 로그인으로 연결할 수 없습니다.",
                409,
            );
        // Same member retries are idempotent, including an unknown HTTP outcome.
        if (hint.contactId === member.id && !hint.mergedIntoId)
            return { id: hint.id, linked: true, merged: false };
        if (hint.mergedIntoId) {
            const [target] = await tx
                .select()
                .from(chats)
                .where(
                    and(
                        eq(chats.id, hint.mergedIntoId),
                        eq(chats.contactId, member.id),
                        eq(chats.channelId, channel.id),
                    ),
                );
            if (target) return { id: target.id, linked: true, merged: true };
        }
        if (
            hint.contactId ||
            hint.mergedIntoId ||
            hint.identifiedAt ||
            hint.historyOnly ||
            hint.medium !== "web"
        )
            throw new InboxError(
                "이미 회원에게 연결된 상담은 다른 계정에 연결할 수 없습니다.",
                409,
            );
        const [existing] = await tx
            .select()
            .from(chats)
            .where(
                and(
                    eq(chats.channelId, channel.id),
                    eq(chats.contactId, member.id),
                    eq(chats.historyOnly, false),
                    eq(chats.medium, "web"),
                    eq(chats.isCurrent, true),
                    isNull(chats.mergedIntoId),
                ),
            );
        const ids = [hint.id, ...(existing ? [existing.id] : [])].sort();
        const locked = await tx
            .select()
            .from(chats)
            .where(inArray(chats.id, ids))
            .orderBy(chats.id)
            .for("update");
        const source = locked.find((c) => c.id === hint.id)!;
        const target = existing
            ? locked.find((c) => c.id === existing.id)!
            : source;
        // Another member may have claimed the source while we waited for its lock.
        if (source.contactId || source.mergedIntoId || source.identifiedAt)
            throw new InboxError(
                "상담 연결이 변경되었습니다. 새로 연결해주세요.",
                409,
            );
        const tags = [...new Set([...target.tags, ...source.tags])];
        if (tags.length > 10)
            throw new InboxError(
                "두 상담의 태그가 10개를 넘습니다. 상담 목록에서 태그를 정리한 후 다시 연결해주세요.",
                409,
            );
        if (target.id !== source.id) {
            const movedReplies = await tx
                .select({ id: messages.id })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, source.id),
                        eq(messages.kind, "reply"),
                    ),
                );
            const duplicates = await tx
                .select({ id: messages.id })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, source.id),
                        sql`EXISTS (SELECT 1 FROM inbox_messages b WHERE b.conversation_id=${target.id}::uuid AND b.client_id=${messages.clientId})`,
                    ),
                )
                .limit(1);
            if (duplicates.length)
                throw new InboxError(
                    "두 상담에 같은 메시지 번호가 있습니다. 이력을 보존하기 위해 연결을 보류했습니다.",
                    409,
                );
            await tx
                .update(messages)
                .set({
                    conversationId: target.id,
                    originConversationId: sql`coalesce(${messages.originConversationId}, ${source.id}::uuid)`,
                })
                .where(eq(messages.conversationId, source.id));
            await moveConversationMentions(tx, target, source.id);
            await tx
                .update(files)
                .set({ draftConversationId: target.id })
                .where(
                    and(
                        eq(files.draftConversationId, source.id),
                        sql`${files.messageId} IS NOT NULL`,
                    ),
                );
            await tx
                .update(chats)
                .set({
                    mergedIntoId: target.id,
                    status: "closed",
                    version: source.version + 1,
                })
                .where(eq(chats.id, source.id));
            if (movedReplies.length) {
                // Bind one typed array so a long-running anonymous thread does
                // not consume one SQL parameter per reply on identification.
                const movedIds = sql`${`{${movedReplies.map(({ id }) => id).join(",")}}`}::integer[]`;
                await tx
                    .insert(inboxCustomerReads)
                    .values({
                        conversationId: target.id,
                        contactId: member.id,
                        mergedUnreadIds: movedReplies.map(({ id }) => id),
                        readRevision: 1,
                    })
                    .onConflictDoUpdate({
                        target: [
                            inboxCustomerReads.conversationId,
                            inboxCustomerReads.contactId,
                        ],
                        set: {
                            mergedUnreadIds: sql`ARRAY(SELECT DISTINCT moved_id FROM unnest(${inboxCustomerReads.mergedUnreadIds} || ${movedIds}) AS moved_id)`,
                            readRevision: sql`${inboxCustomerReads.readRevision}+1`,
                            updatedAt: new Date(),
                        },
                    });
            }
        }
        const now = new Date();
        const reason =
            "비회원 상담을 회원 이력에 연결하여 이전 자동 처리를 중단했습니다.";
        await tx
            .update(customerAiJobs)
            .set({
                state: "stale",
                reason,
                leaseId: null,
                leaseUntil: null,
                updatedAt: now,
            })
            .where(
                and(
                    inArray(customerAiJobs.conversationId, ids),
                    inArray(customerAiJobs.state, [
                        "queued",
                        "generating",
                        "ready",
                    ]),
                ),
            );
        await tx
            .update(runs)
            .set({
                state: "cancelled",
                reason,
                leaseId: null,
                leaseUntil: null,
                updatedAt: now,
            })
            .where(
                and(
                    eq(runs.orgId, channel.orgId),
                    eq(runs.workspaceId, channel.workspaceId),
                    sql`${runs.eventSnapshot}->'data'->>'conversationId' IN (${sql.join(
                        ids.map((id) => sql`${id}`),
                        sql`, `,
                    )})`,
                    inArray(runs.state, [
                        "queued",
                        "running",
                        "waiting",
                        "retry",
                        "failed",
                    ]),
                ),
            );
        // Sent files follow their messages. Unsent files require an explicit re-selection after login.
        await tx
            .update(files)
            .set({ cancelledAt: now })
            .where(
                and(
                    eq(files.channelId, channel.id),
                    eq(files.draftConversationId, source.id),
                    eq(files.kind, "customer"),
                    isNull(files.messageId),
                    isNull(files.cancelledAt),
                ),
            );
        const [latest] = await tx
            .select()
            .from(messages)
            .where(
                and(
                    eq(messages.conversationId, target.id),
                    sql`${messages.kind}<>'note'`,
                ),
            )
            .orderBy(desc(messages.id))
            .limit(1);
        await tx
            .update(chats)
            .set({
                contactId: member.id,
                name: member.name,
                email: member.email,
                recordId: member.recordId,
                identifiedAt: target.identifiedAt ?? now,
                tags,
                teamId:
                    target.teamId || target.assigneeId
                        ? target.teamId
                        : source.teamId,
                assigneeId:
                    target.teamId || target.assigneeId
                        ? target.assigneeId
                        : source.assigneeId,
                priority: target.priority || source.priority,
                aiState: "human",
                aiHandoffReason: "회원 이력 연결 후 상담원이 확인해야 합니다.",
                customerSeq:
                    target.customerSeq +
                    (target.id === source.id ? 0 : source.customerSeq),
                status:
                    source.status === "open" || target.status === "open"
                        ? "open"
                        : target.status,
                preview: latest
                    ? (latest.body || "파일 첨부").slice(0, 200)
                    : target.preview,
                lastMessageAt: latest?.createdAt ?? target.lastMessageAt,
                version: target.version + 1,
                replyRevision: target.replyRevision + 1,
            })
            .where(eq(chats.id, target.id));
        const detail = {
            sourceConversationId: source.id,
            conversationId: target.id,
            contactId: member.id,
            merged: source.id !== target.id,
        };
        await appendInboxAudit(tx, {
            orgId: channel.orgId,
            channelId: channel.id,
            conversationId: target.id,
            actorName: "회원 로그인 연결",
            action: "identity.linked",
            changes: {
                identity: {
                    before: { conversationId: source.id, name: source.name },
                    after: detail,
                    beforeLabel: source.name,
                    afterLabel: `${member.name} · ${source.id === target.id ? "회원 확인" : "기존 상담으로 연결"}`,
                },
            },
        });
        // Historic public messages become CRM activities once, at their original time. Notes stay private.
        await tx.execute(sql`INSERT INTO crm_activities (org_id, workspace_id, contact_id, source, entity_id, event_key, action, summary, actor_name, metadata, occurred_at)
            SELECT ${channel.orgId}::uuid, ${channel.workspaceId}, ${member.id}::uuid, 'conversation', ${target.id}, 'message:'||m.id, m.kind, left(CASE WHEN m.body='' THEN '파일 첨부' ELSE m.body END,200), m.author_name, jsonb_build_object('conversationId',${target.id}::text,'messageId',m.id,'originConversationId',coalesce(m.origin_conversation_id,m.conversation_id)), m.created_at
            FROM inbox_messages m WHERE m.conversation_id=${target.id}::uuid AND m.kind<>'note'
            ON CONFLICT (workspace_id,event_key) DO NOTHING`);
        await appendActivity(tx, {
            orgId: channel.orgId,
            workspaceId: channel.workspaceId,
            contactId: member.id,
            source: "conversation",
            entityId: target.id,
            eventKey: `identity:${source.id}`,
            action: "identity.linked",
            summary: "비회원 상담을 회원 이력에 연결했습니다.",
            metadata: detail,
            occurredAt: now,
        });
        await enqueuePlatformEvent(tx, {
            orgId: channel.orgId,
            workspaceId: channel.workspaceId,
            key: `identity:${source.id}`,
            type: "conversation.identified",
            data: detail,
        });
        return { id: target.id, linked: true, merged: source.id !== target.id };
    });
}
