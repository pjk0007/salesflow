import {
    customerStaffActor,
    requireCustomerAccess,
} from "@/lib/customer-access/access";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { ZodError } from "zod";
import {
    db,
    customerWorkflows as workflows,
    customerWorkflowRuns as runs,
    customerWorkflowSteps as steps,
    customerWorkflowAudit as audit,
    inboxConversations,
    crmDeals,
    crmTasks,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { SalesActor } from "@/lib/customer-platform/sales-repository";
import { InboxError } from "@/lib/inbox/errors";
import { workflowContext } from "./context";
import { executeWorkflowAction } from "./actions";
import { matchesGroup, workflowWorkerEnabled } from "./rules";
import { lockWorkflowWorkspace, workflowRevision } from "./repository";
import { withWorkflowOrigin } from "./origin";
type Run = typeof runs.$inferSelect;
type Options = {
    exec?: DbExec;
    now?: () => Date;
    perform?: typeof executeWorkflowAction;
    beforeExecute?: (run: Run) => Promise<void>;
};
async function lockedRun(id: string, exec: DbExec) {
    const [hint] = await exec
        .select({
            orgId: runs.orgId,
            workspaceId: runs.workspaceId,
            workflowId: runs.workflowId,
        })
        .from(runs)
        .where(eq(runs.id, id));
    if (!hint) return null;
    await lockWorkflowWorkspace(hint.orgId, hint.workspaceId, exec);
    const [workflow] = await exec
        .select()
        .from(workflows)
        .where(eq(workflows.id, hint.workflowId))
        .for("share");
    const [run] = await exec
        .select()
        .from(runs)
        .where(eq(runs.id, id))
        .for("update");
    return { workflow, run };
}
const current = (workflow: typeof workflows.$inferSelect, run: Run) =>
    workflow.enabled &&
    workflow.activeRevisionId === run.revisionId &&
    workflow.generation === run.generation;
async function claim(id: string, exec: DbExec, now: Date) {
    return exec.transaction(async (tx) => {
        const locked = await lockedRun(id, tx);
        if (!locked) return null;
        const { workflow, run } = locked;
        if (
            !["queued", "waiting", "retry", "running"].includes(run.state) ||
            run.eligibleAt > now ||
            (run.leaseUntil && run.leaseUntil > now)
        )
            return null;
        if (!current(workflow, run)) {
            await tx
                .update(runs)
                .set({
                    state: "cancelled",
                    reason: "자동화 설정이 변경되었습니다.",
                    leaseId: null,
                    leaseUntil: null,
                    updatedAt: now,
                })
                .where(eq(runs.id, id));
            return null;
        }
        if (run.attempts >= 5) {
            await tx
                .update(runs)
                .set({
                    state: "failed",
                    reason: "중단된 단계의 복구 한도를 초과했습니다.",
                    leaseId: null,
                    leaseUntil: null,
                    updatedAt: now,
                })
                .where(eq(runs.id, id));
            return null;
        }
        const [saved] = await tx
            .update(runs)
            .set({
                state: "running",
                attempts: run.attempts + 1,
                leaseId: randomUUID(),
                leaseUntil: new Date(now.getTime() + 60000),
                updatedAt: now,
            })
            .where(eq(runs.id, id))
            .returning();
        return saved;
    });
}
async function actorFor(
    orgId: string,
    userId: string | null,
    name: string,
    workspaceId: number,
    exec: DbExec,
): Promise<SalesActor> {
    if (!userId)
        throw new InboxError("게시한 직원의 권한을 확인해주세요.", 403);
    const actor = await customerStaffActor(
        orgId,
        userId,
        `자동화 · ${name}`.slice(0, 100),
        exec,
    );
    await requireCustomerAccess(actor, workspaceId, "manage", exec);
    return actor;
}
async function processClaim(
    job: Run,
    exec: DbExec,
    now: Date,
    perform: typeof executeWorkflowAction,
) {
    return exec.transaction(async (tx) => {
        const locked = await lockedRun(job.id, tx);
        if (!locked) return;
        const { workflow, run } = locked;
        if (run.state !== "running" || run.leaseId !== job.leaseId) return;
        if (!current(workflow, run)) {
            await tx
                .update(runs)
                .set({
                    state: "cancelled",
                    reason: "자동화가 중단되거나 다른 버전이 게시되었습니다.",
                    leaseId: null,
                    leaseUntil: null,
                })
                .where(eq(runs.id, run.id));
            return;
        }
        const revision = await workflowRevision(
                workflow.id,
                run.revisionId,
                tx,
            ),
            actor = await actorFor(
                run.orgId,
                revision.publishedBy,
                revision.name,
                run.workspaceId,
                tx,
            ),
            def = revision.definition;
        let ctx = await workflowContext(
            run.orgId,
            run.workspaceId,
            run.eventSnapshot,
            tx,
        );
        // Lock action targets before re-reading conditions and the reply head. Same workspace is serialized first.
        if (ctx.deal)
            await tx
                .select({ id: crmDeals.id })
                .from(crmDeals)
                .where(eq(crmDeals.id, ctx.deal.id))
                .for("update");
        if (ctx.task)
            await tx
                .select({ id: crmTasks.id })
                .from(crmTasks)
                .where(eq(crmTasks.id, ctx.task.id))
                .for("update");
        if (ctx.conversation)
            await tx
                .select({ id: inboxConversations.id })
                .from(inboxConversations)
                .where(eq(inboxConversations.id, ctx.conversation.id))
                .for("update");
        ctx = await workflowContext(
            run.orgId,
            run.workspaceId,
            run.eventSnapshot,
            tx,
        );
        const base = { leaseId: null, leaseUntil: null, updatedAt: now };
        if (
            ctx.internal ||
            ctx.archived ||
            (run.cursor === 0 && !matchesGroup(def.trigger.when, ctx))
        ) {
            await tx
                .update(runs)
                .set({
                    ...base,
                    state: "skipped",
                    reason: ctx.archived
                        ? "보관된 고객·회사는 자동화에서 제외했습니다."
                        : ctx.internal
                          ? "내부 고객·팀원은 자동화에서 제외했습니다."
                          : "진입 조건에 맞지 않습니다.",
                })
                .where(eq(runs.id, run.id));
            return;
        }
        const step = def.steps[run.cursor];
        if (!step) {
            const done = await tx
                .select({ id: steps.id })
                .from(steps)
                .where(
                    and(eq(steps.runId, run.id), eq(steps.state, "succeeded")),
                )
                .limit(1);
            await tx
                .update(runs)
                .set({
                    ...base,
                    state: done.length ? "succeeded" : "skipped",
                    reason: null,
                })
                .where(eq(runs.id, run.id));
            return;
        }
        const result: Record<string, unknown> = matchesGroup(step.when, ctx)
            ? await withWorkflowOrigin(run.id, () =>
                  perform(tx, actor, run.workspaceId, run.id, step, ctx, now),
              )
            : { skipped: true, reason: "단계 조건에 맞지 않습니다." };
        const state = result.skipped
            ? "skipped"
            : result.waitUntil
              ? "waiting"
              : "succeeded";
        await tx.insert(steps).values({
            runId: run.id,
            stepId: step.id,
            position: run.cursor,
            kind: step.kind,
            state,
            detail: result,
        });
        await tx
            .update(runs)
            .set({
                ...base,
                cursor: run.cursor + 1,
                state: result.waitUntil ? "waiting" : "queued",
                eligibleAt: result.waitUntil
                    ? new Date(String(result.waitUntil))
                    : now,
                attempts: 0,
                reason: null,
            })
            .where(eq(runs.id, run.id));
    });
}
function transient(error: unknown) {
    const candidate = error as { code?: string; cause?: { code?: string } };
    return [
        "40001",
        "40P01",
        "55P03",
        "57014",
        "08006",
        "08003",
        "08000",
    ].includes(candidate?.code ?? candidate?.cause?.code ?? "");
}
async function failed(job: Run, error: unknown, exec: DbExec, now: Date) {
    return exec.transaction(async (tx) => {
        const locked = await lockedRun(job.id, tx);
        if (!locked) return;
        const { run } = locked;
        if (run.state !== "running" || run.leaseId !== job.leaseId) return;
        const retry = transient(error) && run.attempts < 5,
            reason =
                error instanceof InboxError
                    ? error.message
                    : error instanceof ZodError
                      ? "단계에 필요한 고객 정보나 문구를 확인해주세요."
                      : "자동화 처리 중 오류가 발생했습니다. 실행 이력을 확인해주세요.";
        await tx
            .update(runs)
            .set({
                state: retry ? "retry" : "failed",
                leaseId: null,
                leaseUntil: null,
                eligibleAt: new Date(
                    now.getTime() +
                        [5000, 20000, 60000, 300000][
                            Math.min(3, run.attempts - 1)
                        ],
                ),
                reason: reason.slice(0, 500),
                updatedAt: now,
            })
            .where(eq(runs.id, run.id));
        await tx.insert(audit).values({
            workflowId: run.workflowId,
            actorName: "자동화 워커",
            action: retry ? "run.retry_scheduled" : "run.failed",
            detail: {
                runId: run.id,
                cursor: run.cursor,
                attempt: run.attempts,
                reason,
            },
        });
    });
}
export async function processWorkflowRun(id: string, options: Options = {}) {
    const exec = options.exec ?? db,
        now = options.now ?? (() => new Date()),
        job = await claim(id, exec, now());
    if (!job) return false;
    try {
        await options.beforeExecute?.(job);
        await processClaim(
            job,
            exec,
            now(),
            options.perform ?? executeWorkflowAction,
        );
    } catch (error) {
        await failed(job, error, exec, now());
    }
    return true;
}
export async function processWorkflowQueue(options: Options = {}) {
    const exec = options.exec ?? db,
        now = (options.now ?? (() => new Date()))();
    const [job] = await exec
        .select({ id: runs.id })
        .from(runs)
        .where(
            and(
                inArray(runs.state, ["queued", "waiting", "retry", "running"]),
                lte(runs.eligibleAt, now),
                or(
                    eq(runs.state, "queued"),
                    eq(runs.state, "waiting"),
                    eq(runs.state, "retry"),
                    lte(runs.leaseUntil, now),
                ),
            ),
        )
        .orderBy(asc(runs.eligibleAt), asc(runs.id))
        .limit(1);
    if (job) await processWorkflowRun(job.id, options);
    return { processed: job ? 1 : 0 };
}
const runtime = globalThis as typeof globalThis & {
    __sendbWorkflowTimer?: ReturnType<typeof setTimeout>;
};
export function startWorkflowScheduler() {
    if (!workflowWorkerEnabled() || runtime.__sendbWorkflowTimer) return;
    const tick = async () => {
        try {
            await processWorkflowQueue();
        } catch {
            console.error(
                "[customer-workflows] 처리 실패, 다음 회차에서 다시 확인",
            );
        } finally {
            runtime.__sendbWorkflowTimer = setTimeout(() => void tick(), 1500);
            runtime.__sendbWorkflowTimer.unref();
        }
    };
    runtime.__sendbWorkflowTimer = setTimeout(() => void tick(), 1500);
    runtime.__sendbWorkflowTimer.unref();
}
