import { cpus, totalmem } from "node:os";
import {
    copyTransaction,
    ensureGenerationJob,
    generateStoredCopy,
    CopyDeferredError,
    type GenerationDeps,
} from "./generation";
import { percentile } from "./rules";
import type { CopyConnection, CopyJob } from "./types";
import type { EvaluationPair } from "./evaluations";
import { CopyActionError } from "./errors";

export function benchmarkSchedule(start: Date) {
    return Array.from({ length: 3 }, (_, repetition) =>
        Array.from({ length: 210 }, (_, ordinal) => ({
            repetition,
            ordinal,
            scheduledAt: new Date(
                start.getTime() +
                    repetition * 35 * 60_000 +
                    (ordinal < 180 ? ordinal * 10_000 : 30 * 60_000),
            ),
        })),
    ).flat();
}
export async function createBenchmark(
    conn: CopyConnection,
    input: { orgId: string; runId: number; userId: string; region: string; now: Date },
) {
    if (input.region.trim().length < 2)
        throw new CopyActionError("측정 서버의 리전을 확인해 주세요.");
    return copyTransaction(conn, async () => {
        const [evaluation] = await conn<
            { id: number; pairs: EvaluationPair[] }[]
        >`SELECT id,pairs FROM ai_copy_evaluation_runs WHERE id=${input.runId} AND org_id=${input.orgId} AND state='review' FOR UPDATE`;
        if (!evaluation)
            throw new CopyActionError("자동 문구 평가를 마친 뒤 부하 측정을 시작해 주세요.");
        const templates = await conn<
            (CopyJob & { policy_version_id: number })[]
        >`SELECT j.* FROM ai_copy_evaluation_cases c JOIN ai_copy_generation_jobs j ON j.id=c.job_id
            WHERE c.run_id=${evaluation.id} AND j.state='ready' ORDER BY c.id`;
        if (templates.length !== 400)
            throw new CopyActionError("자동 평가 400건이 모두 준비되어야 합니다.");
        const candidates = templates.filter((j) =>
            evaluation.pairs.some((p) => p.candidatePolicyId === j.policy_version_id),
        );
        const hardware = {
            cpu: cpus()[0]?.model ?? "unknown",
            logicalCpus: cpus().length,
            ramMb: Math.round(totalmem() / 1024 / 1024),
            region: input.region.trim(),
            nodeVersion: process.version,
            model: [...new Set(candidates.map((j) => j.policy_snapshot.model))].sort().join(", "),
            inputCharacterRange: {
                min: Math.min(
                    ...candidates.map((j) => j.context.system.length + j.context.user.length),
                ),
                max: Math.max(
                    ...candidates.map((j) => j.context.system.length + j.context.user.length),
                ),
            },
            initialConcurrency: 3,
            actualCustomerData: false,
            smtpCalls: 0,
        };
        const [run] = await conn<
            { id: number }[]
        >`INSERT INTO ai_copy_benchmark_runs(org_id,evaluation_run_id,hardware,started_at,created_by)
            VALUES(${input.orgId},${input.runId},${JSON.stringify(hardware)}::jsonb,${input.now.toISOString()},${input.userId}) RETURNING id`;
        const workspaceIds = evaluation.pairs.map((p) => p.workspaceId);
        const byBusiness = workspaceIds.map((id) =>
            candidates.filter((j) => j.workspace_id === id),
        );
        const cases = benchmarkSchedule(input.now).map((item) => ({
            run_id: run.id,
            template_job_id: byBusiness[item.ordinal % 2][Math.floor(item.ordinal / 2) % 100].id,
            repetition: item.repetition,
            ordinal: item.ordinal,
            scheduled_at: item.scheduledAt.toISOString(),
        }));
        await conn`INSERT INTO ai_copy_benchmark_cases(run_id,template_job_id,repetition,ordinal,scheduled_at)
            SELECT run_id,template_job_id,repetition,ordinal,scheduled_at FROM jsonb_to_recordset(${JSON.stringify(cases)}::jsonb)
            AS x(run_id int,template_job_id int,repetition int,ordinal int,scheduled_at timestamptz)`;
        return {
            id: run.id,
            hardware,
            scheduledSamples: cases.length,
            estimatedMinimumMinutes: 105,
        };
    });
}
export async function processBenchmarkCase(
    conn: CopyConnection,
    input: { orgId: string; caseId: number },
    deps: GenerationDeps,
) {
    const [item] = await conn<
        {
            id: number;
            run_id: number;
            job_id: number | null;
            template_job_id: number;
            scheduled_at: Date;
        }[]
    >`SELECT c.* FROM ai_copy_benchmark_cases c JOIN ai_copy_benchmark_runs r ON r.id=c.run_id
        WHERE c.id=${input.caseId} AND r.org_id=${input.orgId} AND r.state='running' AND c.scheduled_at<=${deps.now().toISOString()}`;
    if (!item) throw new CopyActionError("측정 시각이 되지 않았거나 중단된 작업입니다.");
    let jobId = item.job_id;
    if (!jobId) {
        const [template] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE id=${item.template_job_id} AND org_id=${input.orgId}`;
        const virtualData = JSON.parse(template.context.user) as Record<string, unknown>;
        virtualData.virtualCustomer = `부하 측정 ${item.run_id}의 가상 고객 ${item.id}`;
        const job = await ensureGenerationJob(conn, {
            orgId: input.orgId,
            workspaceId: template.workspace_id,
            purpose: template.purpose,
            key: `benchmark:${item.run_id}:${item.id}`,
            policyVersionId: template.policy_version_id ?? undefined,
            knowledgeVersionId: template.knowledge_version_id ?? undefined,
            policy: template.policy_snapshot,
            knowledge: template.knowledge_snapshot,
            context: { ...template.context, user: JSON.stringify(virtualData) },
            eligibleAt: new Date(item.scheduled_at),
        });
        jobId = job.id;
        await conn`UPDATE ai_copy_benchmark_cases SET job_id=COALESCE(job_id,${jobId}) WHERE id=${item.id}`;
    }
    try {
        await generateStoredCopy(conn, { id: jobId, orgId: input.orgId }, deps);
    } catch (error) {
        if (!(error instanceof CopyDeferredError)) throw error;
    }
}
export async function refreshBenchmark(conn: CopyConnection, orgId: string, id: number) {
    const [run] = await conn<
        {
            id: number;
            evaluation_run_id: number;
            hardware: { cpu: string; ramMb: number; region: string; model: string };
            started_at: Date;
            state: string;
        }[]
    >`SELECT * FROM ai_copy_benchmark_runs WHERE id=${id} AND org_id=${orgId}`;
    if (!run) throw new CopyActionError("부하 측정을 찾을 수 없습니다.");
    const rows = await conn<
        {
            repetition: number;
            ordinal: number;
            state: string | null;
            id: number | null;
            ready_at: Date | null;
            eligible_at: Date | null;
            scheduled_at: Date;
            reason: string | null;
        }[]
    >`
        SELECT c.repetition,c.ordinal,c.scheduled_at,j.id,j.state,j.ready_at,j.eligible_at,j.reason FROM ai_copy_benchmark_cases c LEFT JOIN ai_copy_generation_jobs j ON j.id=c.job_id WHERE c.run_id=${id}`;
    const attempts = await conn<
        { job_id: number; attempt_number: number; duration_ms: number | null; result: string }[]
    >`SELECT a.job_id,a.attempt_number,a.duration_ms,a.result
        FROM ai_copy_generation_attempts a JOIN ai_copy_benchmark_cases c ON c.job_id=a.job_id WHERE c.run_id=${id}`;
    const done = (r: (typeof rows)[number]) =>
        r.state !== null && ["ready", "held", "cancelled"].includes(r.state);
    const completed = rows.length === 630 && rows.every(done);
    const latencies = attempts.filter((a) => a.duration_ms !== null).map((a) => a.duration_ms!);
    const readyDelays = rows
        .filter((r) => r.ready_at)
        .map((r) => new Date(r.ready_at!).getTime() - new Date(r.scheduled_at).getTime());
    const firsts = attempts.filter((a) => a.attempt_number === 1);
    const evidence = {
        ...run.hardware,
        measuredAt: new Date().toISOString(),
        benchmarkRunId: run.id,
        repeats: [0, 1, 2].map((repetition) => ({
            durationMinutes: 30,
            ratePerMinute: 6,
            burstSize: 30,
            initialConcurrency: 3,
            sampleCount: rows.filter((r) => r.repetition === repetition && r.id).length,
            completed: rows.filter((r) => r.repetition === repetition).every(done),
        })),
        measurements: {
            latencies,
            readyDelays,
            firstAttemptSuccess: firsts.length
                ? firsts.filter((a) => a.result === "valid").length / firsts.length
                : null,
            readyWithin30Minutes:
                rows.filter(
                    (r) =>
                        r.ready_at &&
                        new Date(r.ready_at).getTime() - new Date(r.scheduled_at).getTime() <=
                            30 * 60_000,
                ).length / rows.length,
            p95Ms: percentile(latencies, 0.95),
            p99Ms: percentile(latencies, 0.99),
            queueP95Ms: percentile(readyDelays, 0.95),
            failedJobs: rows.filter((r) => r.state === "held").length,
        },
    };
    if (completed && run.state === "running") {
        await conn`UPDATE ai_copy_benchmark_runs SET state='completed',completed_at=now() WHERE id=${id} AND state='running'`;
        await conn`UPDATE ai_copy_evaluation_runs SET performance_evidence=${JSON.stringify(evidence)}::jsonb WHERE id=${run.evaluation_run_id} AND org_id=${orgId}`;
    }
    return {
        id,
        state: completed ? "completed" : run.state,
        finishedSamples: rows.filter(done).length,
        totalSamples: rows.length,
        evidence,
    };
}
