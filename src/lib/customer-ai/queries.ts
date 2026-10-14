import { and, desc, eq, lt, or } from "drizzle-orm";
import { db, customerAiJobs as jobs, customerAiCalls as calls } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { ownedConversation } from "@/lib/inbox/repository";
import { InboxError } from "@/lib/inbox/errors";
import { freshSupportJob } from "./queue";
export async function supportJobPage(
    actor: SalesActor,
    id: string,
    before?: string,
    exec: DbExec = db,
) {
    await ownedConversation(actor, id, exec);
    const base = and(eq(jobs.conversationId, id), eq(jobs.orgId, actor.orgId));
    let cursor;
    if (before) {
        [cursor] = await exec
            .select()
            .from(jobs)
            .where(and(base, eq(jobs.id, before)));
        if (!cursor)
            throw new InboxError("AI 생성 이력 위치를 찾을 수 없습니다.", 404);
    }
    const rows = await exec
        .select({
            id: jobs.id,
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
        rows,
        hasMore: rows.length === 50,
    };
}
export async function supportJobDetail(
    actor: SalesActor,
    id: string,
    conversationId: string,
    exec: DbExec = db,
) {
    await ownedConversation(actor, conversationId, exec);
    const [job] = await exec
        .select()
        .from(jobs)
        .where(
            and(
                eq(jobs.id, id),
                eq(jobs.orgId, actor.orgId),
                eq(jobs.conversationId, conversationId),
            ),
        );
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
    return {
        job: safe,
        calls: usage,
        usable: job.state === "ready" && (await freshSupportJob(job, exec)),
    };
}
