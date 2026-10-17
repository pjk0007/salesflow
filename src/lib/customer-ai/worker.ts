import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    customerAiJobs as jobs,
    customerAiCalls as calls,
    customerAiDailyUsage as daily,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { AI_MODELS } from "@/lib/ai/models";
import { callCopyProvider, CopyProviderError } from "@/lib/ai-copy/provider";
import { sendSystemReply } from "@/lib/inbox/repository";
import { activeReplyWriter } from "@/lib/inbox-reply-guard/repository";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { supportConversation, freshSupportJob, handoffSupport } from "./queue";
import { recordSupportUsage } from "./usage";
import { aiWorkerEnabled } from "./catalog";
import { supportWorkerWorkspaces } from "./worker-policy";
import { supportDeps } from "./runtime";
import {
    humanIntent,
    parseAiJson,
    validateGroundedAnswer,
    buildSupportPrompt,
    buildGroundingPrompt,
    type AiCitation,
} from "./rules";
type Job = typeof jobs.$inferSelect;
export type SupportDeps = {
    now: () => Date;
    quota: (orgId: string) => Promise<boolean>;
    call: typeof callCopyProvider;
    timeoutMs?: number;
};
async function ownedClaim(id: string, exec: DbExec, now: Date) {
    return exec.transaction(async (tx) => {
        const [hint] = await tx
            .select({ conversationId: jobs.conversationId })
            .from(jobs)
            .where(eq(jobs.id, id));
        if (!hint) return null;
        await supportConversation(hint.conversationId, tx, true);
        const [job] = await tx
            .select()
            .from(jobs)
            .where(eq(jobs.id, id))
            .for("update");
        if (
            !["queued", "generating"].includes(job.state) ||
            job.eligibleAt > now ||
            (job.leaseUntil && job.leaseUntil > now)
        )
            return null;
        if (job.attempts >= 2) {
            const [limited] = await tx
                .update(jobs)
                .set({
                    state: "generating",
                    reason: "worker_recovery_limit",
                    leaseId: randomUUID(),
                    leaseUntil: new Date(now.getTime() + 90000),
                })
                .where(eq(jobs.id, id))
                .returning();
            return limited;
        }
        const leaseId = randomUUID();
        const [claimed] = await tx
            .update(jobs)
            .set({
                state: "generating",
                attempts: job.attempts + 1,
                leaseId,
                leaseUntil: new Date(now.getTime() + 90000),
                updatedAt: now,
            })
            .where(eq(jobs.id, id))
            .returning();
        await tx
            .update(calls)
            .set({ state: "interrupted", finishedAt: now })
            .where(and(eq(calls.jobId, id), eq(calls.state, "running")));
        return claimed;
    });
}
async function stage(
    job: Job,
    stage: "answer" | "judge",
    prompt: { system: string; user: string },
    exec: DbExec,
    deps: SupportDeps,
) {
    const model = AI_MODELS.find((m) => m.id === job.settingsSnapshot.model)!;
    const [call] = await exec
        .insert(calls)
        .values({
            jobId: job.id,
            leaseId: job.leaseId!,
            stage,
            provider: model.provider,
            model: model.id,
            startedAt: deps.now(),
        })
        .returning();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = deps.call(
        {
            model: model.id,
            provider: model.provider,
            parameters: {
                maxOutputTokens: stage === "answer" ? 2048 : 1024,
                temperature: stage === "answer" ? 0.3 : 0,
            },
        },
        prompt,
        controller.signal,
    );
    void pending
        .then(async (response) => {
            if (timedOut)
                await recordSupportUsage(exec, call.id, response, true);
        })
        .catch(() => {});
    try {
        const response = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(new Error("AI 응답 시간 초과"));
                }, deps.timeoutMs ?? 25000);
            }),
        ]);
        await recordSupportUsage(exec, call.id, response);
        if (response.truncated) throw new Error("AI 출력이 잘렸습니다.");
        return response;
    } catch (error) {
        await exec
            .update(calls)
            .set({
                state: timedOut ? "timed_out" : "failed",
                finishedAt: deps.now(),
            })
            .where(and(eq(calls.id, call.id), eq(calls.state, "running")));
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
async function finish(
    job: Job,
    result: { answer?: string; citations?: AiCitation[]; reason?: string },
    exec: DbExec,
    now: Date,
) {
    return exec.transaction(async (tx) => {
        const { chat } = await supportConversation(
            job.conversationId,
            tx,
            true,
        );
        const humanWriting =
            job.mode === "reply" && (await activeReplyWriter(tx, chat, now));
        const [fresh] = await tx
            .select()
            .from(jobs)
            .where(eq(jobs.id, job.id))
            .for("update");
        if (fresh.state !== "generating" || fresh.leaseId !== job.leaseId)
            return fresh;
        if (!(await freshSupportJob(job, tx, true, false))) {
            const [stale] = await tx
                .update(jobs)
                .set({
                    state: "stale",
                    reason: "생성 중 대화 또는 설정이 변경되었습니다.",
                    leaseId: null,
                    leaseUntil: null,
                    updatedAt: now,
                })
                .where(eq(jobs.id, job.id))
                .returning();
            return stale;
        }
        if (result.answer && !(await freshSupportJob(job, tx, true, true)))
            result = {
                reason: "사용 지식이 변경되거나 만료되었습니다. 상담원이 확인해주세요.",
            };
        if (result.reason) {
            await tx
                .update(jobs)
                .set({
                    state: "handed_off",
                    reason: result.reason,
                    leaseId: null,
                    leaseUntil: null,
                    updatedAt: now,
                })
                .where(eq(jobs.id, job.id));
            if (job.mode !== "manual") {
                const changed = await handoffSupport(
                    tx,
                    job.conversationId,
                    result.reason,
                    job.settingsSnapshot,
                );
                if (changed && job.mode === "reply" && !humanWriting)
                    await sendSystemReply(
                        tx,
                        job.conversationId,
                        job.settingsSnapshot.handoffMessage,
                        job.id,
                    );
            }
        } else {
            await tx
                .update(jobs)
                .set({
                    state: "ready",
                    answer: result.answer!,
                    citations: result.citations!,
                    reason: humanWriting
                        ? "상담원이 답변을 작성 중이어서 자동 전송을 보류했습니다. 생성한 초안을 확인해주세요."
                        : null,
                    leaseId: null,
                    leaseUntil: null,
                    updatedAt: now,
                })
                .where(eq(jobs.id, job.id));
            if (job.mode === "reply" && !humanWriting)
                await sendSystemReply(
                    tx,
                    job.conversationId,
                    result.answer!,
                    job.id,
                    job.id,
                );
        }
        const [saved] = await tx.select().from(jobs).where(eq(jobs.id, job.id));
        if (saved.state !== "handed_off")
            await enqueuePlatformEvent(tx, {
                orgId: job.orgId,
                workspaceId: job.workspaceId,
                key: `ai-job:${job.id}:${saved.state}`,
                type: "ai.draft.ready",
                data: {
                    conversationId: job.conversationId,
                    runId: job.id,
                    state: saved.state,
                },
            });
        return saved;
    });
}
export async function processSupportJob(
    id: string,
    options: { exec?: DbExec; deps?: SupportDeps } = {},
) {
    const exec = options.exec ?? db,
        deps = options.deps ?? supportDeps(),
        job = await ownedClaim(id, exec, deps.now());
    if (!job) return null;
    try {
        if (job.reason === "worker_recovery_limit")
            return finish(
                job,
                {
                    reason: "AI 생성이 반복 중단되었습니다. 상담원이 확인해주세요.",
                },
                exec,
                deps.now(),
            );
        if (!(await freshSupportJob(job, exec, false, false)))
            return finish(
                job,
                { reason: "대화가 변경되었습니다." },
                exec,
                deps.now(),
            );
        if (humanIntent(job.context.question) || job.context.hasAttachment)
            return finish(
                job,
                { reason: "요청 또는 첨부 자료를 상담원이 확인해야 합니다." },
                exec,
                deps.now(),
            );
        if (
            !job.sources.length ||
            !(await freshSupportJob(job, exec, false, true))
        )
            return finish(
                job,
                { reason: "질문을 해결할 승인 근거가 없습니다." },
                exec,
                deps.now(),
            );
        const day = deps
            .now()
            .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
        const [allowed] = await exec
            .insert(daily)
            .values({ workspaceId: job.workspaceId, day, jobs: 1 })
            .onConflictDoUpdate({
                target: [daily.workspaceId, daily.day],
                set: { jobs: sql`${daily.jobs}+1` },
                setWhere: sql`${daily.jobs}<${job.settingsSnapshot.maxJobsPerDay}`,
            })
            .returning();
        if (!allowed || !(await deps.quota(job.orgId)))
            return finish(
                job,
                {
                    reason: "AI 생성 한도에 도달했습니다. 상담원이 확인해주세요.",
                },
                exec,
                deps.now(),
            );
        const generated = await stage(
                job,
                "answer",
                buildSupportPrompt(
                    job.settingsSnapshot,
                    job.context,
                    job.sources,
                ),
                exec,
                deps,
            ),
            answer = validateGroundedAnswer(
                parseAiJson(generated.content),
                job.sources,
            );
        const [active] = await exec
            .select({ state: jobs.state, leaseId: jobs.leaseId })
            .from(jobs)
            .where(eq(jobs.id, job.id));
        if (active?.state !== "generating" || active.leaseId !== job.leaseId)
            return null;
        if (!(await freshSupportJob(job, exec, false, true)))
            return finish(
                job,
                { reason: "생성 중 대화 또는 근거가 변경되었습니다." },
                exec,
                deps.now(),
            );
        if (!(await deps.quota(job.orgId)))
            return finish(
                job,
                { reason: "답변 검증에 필요한 AI 사용량이 부족합니다." },
                exec,
                deps.now(),
            );
        const judged = await stage(
                job,
                "judge",
                buildGroundingPrompt(
                    answer.answer,
                    answer.citations,
                    job.sources,
                    job.context.question,
                ),
                exec,
                deps,
            ),
            report = z
                .object({
                    supported: z.boolean(),
                    confidence: z.number().min(0).max(1),
                    unsupportedClaims: z.array(z.string()).max(30),
                })
                .parse(parseAiJson(judged.content));
        if (
            !report.supported ||
            report.confidence < 0.85 ||
            report.unsupportedClaims.length
        )
            return finish(
                job,
                { reason: "답변의 모든 내용을 근거로 확인하지 못했습니다." },
                exec,
                deps.now(),
            );
        return finish(job, answer, exec, deps.now());
    } catch (error) {
        const reason =
            error instanceof CopyProviderError
                ? "AI 연결을 확인할 수 없습니다. 상담원이 이어서 안내해주세요."
                : "AI 답변의 근거 또는 응답을 확인하지 못했습니다. 상담원이 안내해주세요.";
        return finish(job, { reason }, exec, deps.now());
    }
}
export async function processSupportQueue(
    options: { exec?: DbExec; deps?: SupportDeps } = {},
) {
    const exec = options.exec ?? db,
        deps = options.deps ?? supportDeps(),
        now = deps.now();
    const scope = supportWorkerWorkspaces(process.env.CUSTOMER_AI_WORKSPACES);
    if (scope !== null && !scope.length) return { processed: 0 };
    const rows = await exec
        .select({ id: jobs.id })
        .from(jobs)
        .where(
            and(
                or(
                    eq(jobs.state, "queued"),
                    and(
                        eq(jobs.state, "generating"),
                        lte(jobs.leaseUntil, now),
                    ),
                ),
                lte(jobs.eligibleAt, now),
                scope === null ? undefined : inArray(jobs.workspaceId, scope),
            ),
        )
        .orderBy(asc(jobs.eligibleAt), asc(jobs.id))
        .limit(1);
    if (rows[0]) await processSupportJob(rows[0].id, { exec, deps });
    return { processed: rows.length };
}
const runtime = globalThis as typeof globalThis & {
    __sendbSupportAiTimer?: ReturnType<typeof setTimeout>;
};
export function startSupportAiScheduler() {
    if (!aiWorkerEnabled() || runtime.__sendbSupportAiTimer) return;
    const tick = async () => {
        try {
            await processSupportQueue();
        } catch {
            console.error("[customer-ai] 처리 실패, 다음 회차에서 다시 확인");
        } finally {
            runtime.__sendbSupportAiTimer = setTimeout(() => void tick(), 5000);
            runtime.__sendbSupportAiTimer.unref();
        }
    };
    runtime.__sendbSupportAiTimer = setTimeout(() => void tick(), 5000);
    runtime.__sendbSupportAiTimer.unref();
}
