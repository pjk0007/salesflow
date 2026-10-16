import {
    requireCustomerConversation,
    customerStaffActor,
    requireCustomerAccess,
    customerAccessPredicate,
} from "@/lib/customer-access/access";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    inboxChannels,
    inboxConversations as chats,
    inboxMessages as messages,
    inboxAttachments,
    customerAiJobs as jobs,
    users,
    organizationMembers,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { sendSystemReply } from "@/lib/inbox/repository";
import { activeReplyWriter } from "@/lib/inbox-reply-guard/repository";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { InboxError } from "@/lib/inbox/errors";
import { claimCapacity, hasCapacity } from "@/lib/inbox-capacity/limits";
import { teamAssignmentHours } from "@/lib/inbox-routing/hours";
import { agentAvailablePredicate } from "@/lib/inbox-presence/repository";
import {
    assignmentTeam,
    chooseTeamAssignee,
    teamMemberPredicate,
} from "@/lib/inbox-routing/assignment";
import { getSupportSettings, chatKnowledge } from "./catalog";
import {
    retrieveSources,
    humanIntent,
    requestUuid,
    type AiSettingsSnapshot,
    type AiContext,
} from "./rules";
export async function supportConversation(
    id: string,
    exec: DbExec = db,
    lock = false,
) {
    const query = exec
        .select({
            chat: chats,
            workspaceId: inboxChannels.workspaceId,
            enabled: inboxChannels.enabled,
        })
        .from(chats)
        .innerJoin(inboxChannels, eq(inboxChannels.id, chats.channelId))
        .where(eq(chats.id, id));
    const [row] = lock ? await query.for("update", { of: chats }) : await query;
    if (!row) throw new InboxError("상담을 찾을 수 없습니다.", 404);
    return row;
}
export async function supportContext(id: string, exec: DbExec = db) {
    const rows = await exec
        .select({ id: messages.id, kind: messages.kind, body: messages.body })
        .from(messages)
        .where(
            and(eq(messages.conversationId, id), sql`${messages.kind}<>'note'`),
        )
        .orderBy(desc(messages.id))
        .limit(12);
    const customer = rows.find((m) => m.kind === "customer");
    return {
        rows: rows.reverse(),
        customer,
        lastPublicId: Math.max(0, ...rows.map((m) => m.id)),
    };
}
export async function handoffSupport(
    exec: DbExec,
    id: string,
    reason: string,
    config: AiSettingsSnapshot,
    actorName = "AI 상담 도우미",
    attention = true,
) {
    return exec.transaction(async (tx) => {
        exec = tx;
        const { chat, workspaceId } = await supportConversation(id, exec, true);
        if (chat.aiState === "human") return false;
        let assigneeId = chat.assigneeId;
        const team =
            attention && !assigneeId && chat.teamId
                ? await assignmentTeam(
                      exec,
                      chat.orgId,
                      chat.channelId,
                      chat.teamId,
                      false,
                  )
                : null;
        const withinHours =
            !team || (await teamAssignmentHours(exec, team))?.open !== false;
        if (
            attention &&
            !assigneeId &&
            config.handoffAssigneeId &&
            withinHours
        ) {
            const [person] = await exec
                .select({ id: users.id })
                .from(users)
                .innerJoin(
                    organizationMembers,
                    eq(organizationMembers.userId, users.id),
                )
                .where(
                    and(
                        eq(users.id, config.handoffAssigneeId),
                        eq(users.isActive, 1),
                        eq(organizationMembers.organizationId, chat.orgId),
                        hasCapacity(chat.channelId, users.id, chat.id),
                        team?.requireAvailable
                            ? agentAvailablePredicate(chat.channelId, users.id)
                            : undefined,
                        chat.teamId
                            ? teamMemberPredicate(chat.teamId, sql`${users.id}`)
                            : undefined,
                        customerAccessPredicate(
                            chat.orgId,
                            users.id,
                            sql`${workspaceId}`,
                            "respond",
                        ),
                    ),
                );
            assigneeId =
                person &&
                (await claimCapacity(
                    exec,
                    chat.channelId,
                    person.id,
                    chat.id,
                )) &&
                (!team ||
                    (await teamAssignmentHours(exec, team))?.open !== false)
                    ? person.id
                    : null;
        }
        if (attention && !assigneeId && chat.teamId) {
            if (team)
                assigneeId = await chooseTeamAssignee(exec, team, chat.id);
        }
        await exec
            .update(chats)
            .set({
                aiState: "human",
                aiHandoffReason: reason.slice(0, 300),
                priority: attention ? true : chat.priority,
                assigneeId,
                status: "open",
                version: chat.version + 1,
            })
            .where(eq(chats.id, id));
        await appendInboxAudit(exec, {
            orgId: chat.orgId,
            channelId: chat.channelId,
            conversationId: id,
            actorName,
            action: "ai.handoff",
            changes: {
                aiState: { before: chat.aiState, after: "human" },
                priority: {
                    before: chat.priority,
                    after: attention ? true : chat.priority,
                },
                assigneeId: { before: chat.assigneeId, after: assigneeId },
            },
        });
        await enqueuePlatformEvent(exec, {
            orgId: chat.orgId,
            workspaceId,
            key: `ai-handoff:${id}:${chat.version + 1}`,
            type: "ai.handoff",
            data: {
                conversationId: id,
                aiState: "human",
                assigneeId,
                priority: attention ? true : chat.priority,
            },
        });
        return true;
    });
}
export async function queueSupportJob(
    actor: SalesActor | undefined,
    id: string,
    clientId: string,
    exec: DbExec = db,
) {
    z.string().uuid().parse(clientId);
    if (actor) await requireCustomerConversation(actor, id, "respond", exec);
    return exec.transaction(async (tx) => {
        const { chat, workspaceId, enabled } = await supportConversation(
            id,
            tx,
            true,
        );
        if (chat.medium !== "web")
            throw new InboxError(
                "이메일 상담의 AI 초안은 아직 지원하지 않습니다.",
                409,
            );
        if (!enabled || chat.status !== "open" || chat.historyOnly)
            throw new InboxError(
                "진행 중인 상담에서 초안을 생성해주세요.",
                409,
            );
        const context = await supportContext(id, tx),
            config = await getSupportSettings(chat.orgId, workspaceId, tx);
        if (!context.customer)
            throw new InboxError(
                "고객 문의가 들어온 뒤 초안을 만들 수 있습니다.",
            );
        const [prior] = await tx
            .select()
            .from(jobs)
            .where(
                and(eq(jobs.conversationId, id), eq(jobs.clientId, clientId)),
            );
        if (prior) {
            if (prior.sourceMessageId !== context.customer.id)
                throw new InboxError(
                    "새 문의에는 새 생성 번호를 사용해주세요.",
                    409,
                );
            return prior;
        }
        const facts = await chatKnowledge(
                chat.orgId,
                workspaceId,
                config.knowledgeVersionId,
                tx,
            ),
            query = context.rows
                .filter((m) => m.kind === "customer")
                .slice(-3)
                .map((m) => m.body)
                .join("\n"),
            sources = retrieveSources(query, facts.sources);
        const attached = await tx
            .select({ id: inboxAttachments.id })
            .from(inboxAttachments)
            .where(eq(inboxAttachments.messageId, context.customer.id))
            .limit(1);
        const input: AiContext = {
            messages: context.rows.map((m) => ({
                ...m,
                body: m.body.slice(0, 1500),
            })),
            question: context.customer.body,
            hasAttachment: attached.length > 0,
        };
        const [job] = await tx
            .insert(jobs)
            .values({
                orgId: chat.orgId,
                workspaceId,
                conversationId: id,
                clientId,
                sourceMessageId: context.customer.id,
                lastPublicId: context.lastPublicId,
                mode: actor ? "manual" : config.mode,
                settingsVersion: config.version,
                settingsSnapshot: config,
                knowledgeVersionId: config.knowledgeVersionId,
                knowledgeFingerprint: facts.version?.fingerprint ?? null,
                sources,
                context: input,
                requestedBy: actor?.userId,
                eligibleAt: new Date(Date.now() + (actor ? 0 : 10000)),
            })
            .returning();
        return job;
    });
}
export async function onSupportMessage(
    exec: DbExec,
    id: string,
    message: {
        id: number;
        clientId: string;
        kind: string;
        body: string;
        authorId?: string | null;
        aiDraftId?: string | null;
    },
    attachmentCount: number,
) {
    const { chat, workspaceId } = await supportConversation(id, exec);
    if (message.kind === "note") return;
    await exec
        .update(jobs)
        .set({
            state: "stale",
            reason: "대화가 변경되었습니다. 최신 문의로 다시 생성해주세요.",
            leaseId: null,
            leaseUntil: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(jobs.conversationId, id),
                inArray(jobs.state, ["queued", "generating", "ready"]),
                message.aiDraftId
                    ? sql`${jobs.id}<>${message.aiDraftId}::uuid`
                    : undefined,
            ),
        );
    const config = await getSupportSettings(chat.orgId, workspaceId, exec);
    if (message.kind === "reply" && message.authorId) {
        await handoffSupport(
            exec,
            id,
            "상담원이 직접 답변했습니다.",
            config,
            "상담원",
            false,
        );
        return;
    }
    if (message.kind !== "customer") return;
    if (humanIntent(message.body) || attachmentCount > 0) {
        const changed = await handoffSupport(
            exec,
            id,
            attachmentCount
                ? "첨부 자료는 상담원이 확인해야 합니다."
                : "고객이 상담원 연결 또는 처리를 요청했습니다.",
            config,
            "고객 요청",
        );
        // The caller holds the conversation lock. Keep the customer message and
        // handoff when a staff writer blocks only the automatic announcement.
        if (
            changed &&
            config.mode === "reply" &&
            !(await activeReplyWriter(exec, chat))
        )
            await sendSystemReply(
                exec,
                id,
                config.handoffMessage,
                requestUuid(`handoff:${message.clientId}`),
            );
        return;
    }
    if (
        config.mode === "manual" ||
        (config.mode === "reply" && chat.aiState === "human")
    )
        return;
    await queueSupportJob(
        undefined,
        id,
        requestUuid(`automatic:${id}:${message.id}:${config.version}`),
        exec,
    );
}
export async function freshSupportJob(
    job: typeof jobs.$inferSelect,
    exec: DbExec = db,
    lock = false,
    requireKnowledge = true,
) {
    const { chat, workspaceId, enabled } = await supportConversation(
            job.conversationId,
            exec,
        ),
        config = await getSupportSettings(job.orgId, workspaceId, exec, lock),
        context = await supportContext(job.conversationId, exec);
    if (
        !enabled ||
        chat.status !== "open" ||
        context.lastPublicId !== job.lastPublicId ||
        config.version !== job.settingsVersion ||
        (job.mode === "reply" && chat.aiState === "human")
    )
        return false;
    if (job.requestedBy) {
        try {
            await requireCustomerAccess(
                await customerStaffActor(
                    job.orgId,
                    job.requestedBy,
                    "초안 요청 직원",
                    exec,
                ),
                workspaceId,
                "respond",
                exec,
            );
        } catch {
            return false;
        }
    }
    if (!requireKnowledge) return true;
    const facts = await chatKnowledge(
        job.orgId,
        workspaceId,
        job.knowledgeVersionId,
        exec,
        new Date(),
        lock,
    );
    return (
        !!facts.version &&
        facts.version.fingerprint === job.knowledgeFingerprint &&
        job.sources.every((s) =>
            facts.sources.some((f) => f.id === s.id && f.text === s.text),
        )
    );
}
export async function consumeSupportDraft(
    exec: DbExec,
    id: string,
    conversationId: string,
    body: string,
    authorId: string | undefined,
) {
    const [job] = await exec
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.conversationId, conversationId)))
        .for("update");
    if (
        !job ||
        job.state !== "ready" ||
        !(await freshSupportJob(job, exec, true))
    )
        throw new InboxError(
            "AI 초안의 근거 또는 대화가 변경되었습니다. 최신 초안을 생성하거나 일반 답변으로 보내주세요.",
            409,
        );
    if (!authorId && body !== job.answer)
        throw new InboxError("AI 자동 답변 본문이 변경되었습니다.", 409);
    await exec
        .update(jobs)
        .set({
            state: "sent",
            sentBy: authorId ?? null,
            leaseId: null,
            leaseUntil: null,
            updatedAt: new Date(),
        })
        .where(eq(jobs.id, id));
    return job;
}
