import { queryClient } from "../db";
import { processEvaluationCase, refreshEvaluationReport } from "./evaluations";
import { generationDeps } from "./runtime";
import { processBenchmarkCase, refreshBenchmark } from "./benchmark";
import type { CopyConnection } from "./types";
import { advanceExperimentLifecycles } from "../email-experiments/actions";
import { finalizeCopyReplacement } from "./revisions";
import { generateStoredCopy, CopyDeferredError } from "./generation";

export async function processCopyEvaluations(
    input?: { orgId: string; runId: number },
    providedConnection?: CopyConnection,
) {
    const conn = providedConnection ?? (await queryClient.reserve());
    let locked = false;
    try {
        const [lock] = await conn<
            { locked: boolean }[]
        >`SELECT pg_try_advisory_lock(1760824302) AS locked`;
        if (!lock.locked) return { processed: 0, busy: true };
        locked = true;
        await advanceExperimentLifecycles(conn, new Date(), input?.orgId);
        const replacements = await conn<
            { id: number; org_id: string }[]
        >`SELECT id,org_id FROM ai_copy_generation_jobs WHERE origin='replacement' AND ${!input}
            AND (${input?.orgId ?? null}::uuid IS NULL OR org_id=${input?.orgId ?? null}::uuid) AND state IN('pending','retry','generating') AND (retry_at IS NULL OR retry_at<=now()) AND (lease_until IS NULL OR lease_until<=now()) ORDER BY eligible_at,id LIMIT 3`;
        const readyReplacements = await conn<
            { id: number; org_id: string }[]
        >`SELECT j.id,j.org_id FROM ai_copy_generation_jobs j JOIN ai_copy_generation_jobs old ON old.superseded_by_id=j.id
            WHERE j.origin='replacement' AND ${!input} AND j.state='ready' AND old.state='held' AND (${input?.orgId ?? null}::uuid IS NULL OR j.org_id=${input?.orgId ?? null}::uuid) ORDER BY j.id LIMIT 3`;
        if (replacements.length || readyReplacements.length) {
            await Promise.allSettled(
                replacements.map(async (job) => {
                    const workerConn = await queryClient.reserve();
                    try {
                        await generateStoredCopy(
                            workerConn,
                            { id: job.id, orgId: job.org_id },
                            generationDeps(),
                        );
                    } catch (error) {
                        if (!(error instanceof CopyDeferredError)) throw error;
                    } finally {
                        workerConn.release();
                    }
                }),
            );
            for (const job of [...replacements, ...readyReplacements])
                await finalizeCopyReplacement(conn, { id: job.id, orgId: job.org_id });
            return { processed: replacements.length, replacements: true };
        }
        const benchmarks = input
            ? await conn<
                  { id: number; org_id: string; evaluation_run_id: number }[]
              >`SELECT id,org_id,evaluation_run_id FROM ai_copy_benchmark_runs WHERE org_id=${input.orgId} AND evaluation_run_id=${input.runId} AND state='running' ORDER BY id LIMIT 1`
            : await conn<
                  { id: number; org_id: string; evaluation_run_id: number }[]
              >`SELECT id,org_id,evaluation_run_id FROM ai_copy_benchmark_runs WHERE state='running' ORDER BY id LIMIT 1`;
        if (benchmarks[0]) {
            const benchmark = benchmarks[0];
            const due = await conn<
                { id: number }[]
            >`SELECT c.id FROM ai_copy_benchmark_cases c LEFT JOIN ai_copy_generation_jobs j ON j.id=c.job_id
                WHERE c.run_id=${benchmark.id} AND c.scheduled_at<=now() AND (j.id IS NULL OR j.state IN ('pending','retry','generating') AND (j.retry_at IS NULL OR j.retry_at<=now()) AND (j.lease_until IS NULL OR j.lease_until<=now()))
                ORDER BY c.scheduled_at,c.id LIMIT 3`;
            const results = await Promise.allSettled(
                due.map(async (item) => {
                    const workerConn = await queryClient.reserve();
                    try {
                        await processBenchmarkCase(
                            workerConn,
                            { orgId: benchmark.org_id, caseId: item.id },
                            generationDeps(),
                        );
                    } finally {
                        workerConn.release();
                    }
                }),
            );
            const report = await refreshBenchmark(conn, benchmark.org_id, benchmark.id);
            if (report.state === "completed")
                await refreshEvaluationReport(conn, benchmark.org_id, benchmark.evaluation_run_id);
            return {
                processed: results.filter((r) => r.status === "fulfilled").length,
                benchmark: report,
            };
        }
        const runs = input
            ? await conn<
                  { id: number; org_id: string }[]
              >`SELECT id,org_id FROM ai_copy_evaluation_runs WHERE id=${input.runId} AND org_id=${input.orgId} AND state IN ('pending','running')`
            : await conn<
                  { id: number; org_id: string }[]
              >`SELECT id,org_id FROM ai_copy_evaluation_runs WHERE state IN ('pending','running') ORDER BY id LIMIT 1`;
        const run = runs[0];
        if (!run) return { processed: 0, busy: false };
        const cases = await conn<
            { id: number }[]
        >`SELECT c.id FROM ai_copy_evaluation_cases c LEFT JOIN ai_copy_generation_jobs j ON j.id=c.job_id
            WHERE c.run_id=${run.id} AND (j.id IS NULL OR j.state IN ('pending','retry','generating') AND (j.retry_at IS NULL OR j.retry_at<=now()) AND (j.lease_until IS NULL OR j.lease_until<=now())) ORDER BY c.id LIMIT 3`;
        const results = await Promise.allSettled(
            cases.map(async (item) => {
                const workerConn = await queryClient.reserve();
                try {
                    await processEvaluationCase(
                        workerConn,
                        { orgId: run.org_id, caseId: item.id },
                        generationDeps(),
                    );
                } finally {
                    workerConn.release();
                }
            }),
        );
        const report = await refreshEvaluationReport(conn, run.org_id, run.id);
        return {
            processed: results.filter((r) => r.status === "fulfilled").length,
            failed: results.filter((r) => r.status === "rejected").length,
            report,
        };
    } finally {
        if (locked) await conn`SELECT pg_advisory_unlock(1760824302)`;
        if (!providedConnection) conn.release();
    }
}

const evaluationServer = globalThis as typeof globalThis & {
    __sendbCopyWorker?: ReturnType<typeof setTimeout>;
};
/** 개발 서비스에서도 평가와 가상 부하만 처리한다. 이메일 스케줄러 활성화 조건과 독립적이다. */
export function startCopyEvaluationScheduler() {
    if (
        process.env.NODE_ENV !== "production" ||
        process.env.AI_COPY_EVALUATION_WORKER === "off" ||
        evaluationServer.__sendbCopyWorker
    )
        return;
    const tick = async () => {
        try {
            await processCopyEvaluations();
        } catch {
            console.error("[ai-copy-worker] 평가 처리 실패 — 다음 회차에서 재시도");
        } finally {
            evaluationServer.__sendbCopyWorker = setTimeout(() => void tick(), 10_000);
            evaluationServer.__sendbCopyWorker.unref();
        }
    };
    evaluationServer.__sendbCopyWorker = setTimeout(() => void tick(), 10_000);
    evaluationServer.__sendbCopyWorker.unref();
}
