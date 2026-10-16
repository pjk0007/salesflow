import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import {
    db,
    customerAiJobs as jobs,
    customerAiCalls as calls,
    inboxConversations as chats,
    inboxChannels as channels,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { ownedConversation } from "@/lib/inbox/repository";
import { InboxError } from "@/lib/inbox/errors";
import { freshSupportJob } from "./queue";

async function supportHistoryScope(actor: SalesActor, id: string, exec: DbExec) {
    const current = await ownedConversation(actor, id, exec);
    // Login merges retain the anonymous source's null contactId. A different
    // identified member is never an eligible source, even with a merge pointer.
    const sameCustomer = current.contactId
        ? or(isNull(chats.contactId), eq(chats.contactId, current.contactId))
        : isNull(chats.contactId);
    return and(
        eq(jobs.orgId, actor.orgId),
        eq(chats.orgId, actor.orgId),
        eq(channels.orgId, actor.orgId),
        eq(chats.channelId, current.channelId),
        eq(jobs.workspaceId, channels.workspaceId),
        or(
            eq(chats.id, id),
            and(eq(chats.mergedIntoId, id), sameCustomer),
        ),
    );
}

export async function supportJobPage(
    actor: SalesActor,
    id: string,
    before?: string,
    exec: DbExec = db,
) {
    const base = await supportHistoryScope(actor, id, exec);
    let cursor;
    if (before) {
        [cursor] = await exec
            .select({ id: jobs.id, createdAt: jobs.createdAt })
            .from(jobs)
            .innerJoin(chats, eq(chats.id, jobs.conversationId))
            .innerJoin(channels, eq(channels.id, chats.channelId))
            .where(and(base, eq(jobs.id, before)));
        if (!cursor)
            throw new InboxError("AI 생성 이력 위치를 찾을 수 없습니다.", 404);
    }
    const rows = await exec
        .select({
            id: jobs.id,
            originConversationId: jobs.conversationId,
            state: jobs.state,
            createdAt: jobs.createdAt,
            mode: jobs.mode,
            sourceMessageId: jobs.sourceMessageId,
            settingsVersion: jobs.settingsVersion,
            knowledgeVersionId: jobs.knowledgeVersionId,
            reason: jobs.reason,
            sentMessageId: jobs.sentMessageId,
        })
        .from(jobs)
        .innerJoin(chats, eq(chats.id, jobs.conversationId))
        .innerJoin(channels, eq(channels.id, chats.channelId))
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(jobs.createdAt, cursor.createdAt),
                          and(
                              eq(jobs.createdAt, cursor.createdAt),
                              lt(jobs.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(50);
    return {
        rows: rows.map((row) => ({
            ...row,
            fromMergedConversation: row.originConversationId !== id,
        })),
        hasMore: rows.length === 50,
    };
}
export async function supportJobDetail(
    actor: SalesActor,
    id: string,
    conversationId: string,
    exec: DbExec = db,
) {
    const base = await supportHistoryScope(actor, conversationId, exec);
    const [row] = await exec
        .select({ job: jobs })
        .from(jobs)
        .innerJoin(chats, eq(chats.id, jobs.conversationId))
        .innerJoin(channels, eq(channels.id, chats.channelId))
        .where(and(base, eq(jobs.id, id)));
    const job = row?.job;
    if (!job) throw new InboxError("AI 생성 이력을 찾을 수 없습니다.", 404);
    const usage = await exec
        .select({
            id: calls.id,
            stage: calls.stage,
            state: calls.state,
            provider: calls.provider,
            model: calls.model,
            promptTokens: calls.promptTokens,
            completionTokens: calls.completionTokens,
            startedAt: calls.startedAt,
            finishedAt: calls.finishedAt,
        })
        .from(calls)
        .where(eq(calls.jobId, id))
        .orderBy(desc(calls.startedAt), desc(calls.id));
    const { leaseId: _, ...safe } = job;
    void _;
    const fromMergedConversation = job.conversationId !== conversationId;
    return {
        job: {
            ...safe,
            originConversationId: job.conversationId,
            fromMergedConversation,
        },
        calls: usage,
        usable:
            !fromMergedConversation &&
            job.state === "ready" &&
            (await freshSupportJob(job, exec)),
    };
}
