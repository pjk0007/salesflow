import { randomUUID } from "node:crypto";
import type {
    CopyConnection,
    CopyJob,
    CopyOutput,
    GenerationContext,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "./types";
import {
    buildCopyPrompt,
    GENERATION_LEASE_MS,
    MAX_TRANSIENT_RETRIES,
    parseCopyOutput,
    passedPreparationDeadline,
    validateCopy,
} from "./rules";
import { CopyProviderError, type CopyProviderResponse } from "./provider";

export class CopyDeferredError extends Error {
    constructor(
        readonly retryAt: Date,
        readonly reason: string,
        readonly held = false,
    ) {
        super(reason);
    }
}
export interface GenerationDeps {
    now: () => Date;
    quota: (orgId: string) => Promise<boolean>;
    call: (
        policy: PolicySnapshot,
        prompt: { system: string; user: string },
        signal: AbortSignal,
    ) => Promise<CopyProviderResponse>;
    timeoutMs?: number;
    /** 타임아웃 이후 응답도 별도 연결에서 사용량만 반영한다. 늦은 본문은 절대 채택하지 않는다. */
    late?: (attemptId: number, response: CopyProviderResponse) => Promise<void>;
}
export async function copyTransaction<T>(conn: CopyConnection, fn: () => Promise<T>): Promise<T> {
    await conn`BEGIN`;
    try {
        const value = await fn();
        await conn`COMMIT`;
        return value;
    } catch (error) {
        await conn`ROLLBACK`;
        throw error;
    }
}
export async function ensureGenerationJob(
    conn: CopyConnection,
    input: {
        orgId: string;
        workspaceId: number;
        purpose: PolicySnapshot["purpose"];
        key: string;
        policyVersionId?: number;
        knowledgeVersionId?: number;
        assignmentId?: number;
        policy: PolicySnapshot;
        knowledge: KnowledgeSnapshot | null;
        context: GenerationContext;
        approvedContext?: GenerationContext;
        eligibleAt?: Date;
    },
): Promise<CopyJob> {
    const origin = input.key.startsWith("evaluation:")
        ? "evaluation"
        : input.key.startsWith("benchmark:")
          ? "benchmark"
          : input.key.startsWith("replacement:")
            ? "replacement"
            : "operational";
    const [job] = await conn<CopyJob[]>`INSERT INTO ai_copy_generation_jobs
        (org_id,workspace_id,purpose,idempotency_key,policy_version_id,knowledge_version_id,assignment_id,policy_snapshot,knowledge_snapshot,context,approved_context,eligible_at,origin)
        VALUES (${input.orgId},${input.workspaceId},${input.purpose},${input.key},${input.policyVersionId ?? null},${input.knowledgeVersionId ?? null},${input.assignmentId ?? null},
        ${JSON.stringify(input.policy)}::jsonb,${JSON.stringify(input.knowledge)}::jsonb,${JSON.stringify(input.context)}::jsonb,${JSON.stringify(input.approvedContext ?? null)}::jsonb,${(input.eligibleAt ?? new Date()).toISOString()},${origin})
        ON CONFLICT(org_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`;
    if (job.workspace_id !== input.workspaceId || job.purpose !== input.purpose)
        throw new Error("생성 작업 범위 불일치");
    return job;
}
export async function recordAttemptUsage(
    conn: CopyConnection,
    attemptId: number,
    response: CopyProviderResponse,
    late = false,
) {
    await copyTransaction(conn, async () => {
        const [attempt] = await conn<
            {
                org_id: string;
                provider: string;
                model: string;
                started_at: Date;
                purpose: string;
                origin: string;
                usage_logged: boolean;
                prompt_tokens: number | null;
                completion_tokens: number | null;
                charged_prompt_tokens: number;
                charged_completion_tokens: number;
                usage_log_id: number | null;
                price_version_id: number | null;
            }[]
        >`
            SELECT a.*,j.purpose,j.origin FROM ai_copy_generation_attempts a JOIN ai_copy_generation_jobs j ON j.id=a.job_id WHERE a.id=${attemptId} FOR UPDATE OF a`;
        if (!attempt) return;
        const promptTokens =
            response.promptTokens === null
                ? attempt.prompt_tokens
                : Math.max(attempt.prompt_tokens ?? 0, response.promptTokens);
        const completionTokens =
            response.completionTokens === null
                ? attempt.completion_tokens
                : Math.max(attempt.completion_tokens ?? 0, response.completionTokens);
        const known = promptTokens !== null && completionTokens !== null;
        const anyKnown = promptTokens !== null || completionTokens !== null;
        const promptDelta = Math.max(0, (promptTokens ?? 0) - attempt.charged_prompt_tokens),
            completionDelta = Math.max(
                0,
                (completionTokens ?? 0) - attempt.charged_completion_tokens,
            );
        const prices = await conn<
            {
                id: number;
                input_per_million: string;
                output_per_million: string;
                currency: string;
                fx_to_krw: string | null;
            }[]
        >`
            SELECT * FROM ai_copy_price_versions WHERE org_id=${attempt.org_id} AND provider=${attempt.provider} AND model=${attempt.model}
            AND ((${attempt.price_version_id}::int IS NOT NULL AND id=${attempt.price_version_id}) OR (${attempt.price_version_id}::int IS NULL AND NOT ${attempt.usage_logged} AND effective_at<=${attempt.started_at})) ORDER BY effective_at DESC LIMIT 1`;
        const price = prices[0];
        const cost =
            known && price
                ? (promptTokens! * Number(price.input_per_million) +
                      completionTokens! * Number(price.output_per_million)) /
                  1_000_000
                : null;
        const costKrw =
            cost !== null && price
                ? price.currency === "KRW"
                    ? cost
                    : price.fx_to_krw
                      ? cost * Number(price.fx_to_krw)
                      : null
                : null;
        await conn`UPDATE ai_copy_generation_attempts SET prompt_tokens=${promptTokens},completion_tokens=${completionTokens},
            usage_known=${known},late_usage_known=late_usage_known OR ${late && anyKnown},price_version_id=${price?.id ?? null},cost=${cost},currency=${price?.currency ?? null},cost_krw=${costKrw},usage_logged=${anyKnown},
            charged_prompt_tokens=${Math.max(attempt.charged_prompt_tokens, promptTokens ?? 0)},charged_completion_tokens=${Math.max(attempt.charged_completion_tokens, completionTokens ?? 0)} WHERE id=${attemptId}`;
        if (!anyKnown) return;
        const month = new Date(attempt.started_at).toISOString().slice(0, 7);
        if (promptDelta + completionDelta > 0)
            await conn`INSERT INTO ai_usage_quotas(org_id,month,total_tokens) VALUES(${attempt.org_id},${month},${promptDelta + completionDelta})
            ON CONFLICT(org_id,month) DO UPDATE SET total_tokens=ai_usage_quotas.total_tokens+EXCLUDED.total_tokens,updated_at=now()`;
        if (attempt.usage_log_id)
            await conn`UPDATE ai_usage_logs SET prompt_tokens=${promptTokens ?? 0},completion_tokens=${completionTokens ?? 0} WHERE id=${attempt.usage_log_id} AND org_id=${attempt.org_id}`;
        else if (!attempt.usage_logged) {
            const purpose =
                attempt.origin === "evaluation"
                    ? "copy_evaluation"
                    : attempt.origin === "benchmark"
                      ? "copy_benchmark"
                      : `copy_${attempt.purpose}`;
            const [log] = await conn<
                { id: number }[]
            >`INSERT INTO ai_usage_logs(org_id,provider,model,prompt_tokens,completion_tokens,purpose)
                VALUES(${attempt.org_id},${attempt.provider},${attempt.model},${promptTokens ?? 0},${completionTokens ?? 0},${purpose}) RETURNING id`;
            await conn`UPDATE ai_copy_generation_attempts SET usage_log_id=${log.id} WHERE id=${attemptId}`;
        }
    });
}
async function policyBlocked(conn: CopyConnection, job: CopyJob) {
    const [versions] = await conn<
        { blocked: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM ai_copy_policy_versions WHERE id=${job.policy_version_id} AND state='blocked')
        OR EXISTS(SELECT 1 FROM ai_copy_knowledge_versions WHERE id=${job.knowledge_version_id} AND state='blocked') AS blocked`;
    return versions?.blocked;
}
/** 작업 본문은 원자적으로 한 번 보관한다. 재시도는 같은 버전과 같은 입력을 사용한다. */
export async function generateStoredCopy(
    conn: CopyConnection,
    target: { id: number; orgId: string },
    deps: GenerationDeps,
): Promise<CopyOutput> {
    const now = deps.now();
    const [existing] = await conn<
        CopyJob[]
    >`SELECT * FROM ai_copy_generation_jobs WHERE id=${target.id} AND org_id=${target.orgId}`;
    if (!existing) throw new Error("생성 작업을 찾을 수 없습니다.");
    if (existing.state === "cancelled")
        throw new CopyDeferredError(new Date(now.getTime() + 3600_000), "작업 취소", true);
    if (await policyBlocked(conn, existing)) {
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='blocked_version',updated_at=${now.toISOString()} WHERE id=${existing.id} AND state<>'cancelled'`;
        throw new CopyDeferredError(new Date(now.getTime() + 3600_000), "차단된 버전", true);
    }
    if (existing.state === "held")
        throw new CopyDeferredError(
            new Date(now.getTime() + 3600_000),
            existing.reason ?? "검토 대기",
            true,
        );
    if (existing.output && existing.state === "ready") return existing.output;
    if (!(await deps.quota(existing.org_id))) {
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='token_quota',updated_at=${now.toISOString()} WHERE id=${existing.id} AND state IN ('pending','retry')`;
        throw new CopyDeferredError(new Date(now.getTime() + 3600_000), "AI 사용 한도", true);
    }
    const lease = randomUUID();
    const claimed = await copyTransaction(conn, async () => {
        await conn`SELECT pg_advisory_xact_lock(1760824301)`;
        const [fresh] = await conn<
            CopyJob[]
        >`SELECT * FROM ai_copy_generation_jobs WHERE id=${target.id} AND org_id=${target.orgId} FOR UPDATE`;
        if (fresh.state === "ready" && fresh.output) return { output: fresh.output };
        if (!["pending", "retry", "generating"].includes(fresh.state)) return null;
        if (
            (fresh.retry_at && new Date(fresh.retry_at) > now) ||
            (fresh.lease_until && new Date(fresh.lease_until) > now)
        )
            return null;
        const [first] = await conn<
            { at: Date | null }[]
        >`SELECT min(started_at) AS at FROM ai_copy_generation_attempts WHERE job_id=${fresh.id} AND started_at>=${new Date(fresh.eligible_at).toISOString()}`;
        if (passedPreparationDeadline({ attempts: fresh.attempts, firstAttemptAt: first?.at ?? null }, now)) {
            await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='preparation_deadline',lease_until=NULL WHERE id=${fresh.id}`;
            return null;
        }
        const [active] = await conn<
            { count: number }[]
        >`SELECT count(*)::int AS count FROM ai_copy_generation_jobs WHERE state='generating' AND lease_until>${now.toISOString()}`;
        if (active.count >= 3) return null;
        // 프로세스 중단 뒤 남은 시도는 비용 확인이 필요한 타임아웃으로 남긴다.
        await conn`UPDATE ai_copy_generation_attempts SET result='timeout',reason='worker_lease_expired',finished_at=${now.toISOString()},duration_ms=${GENERATION_LEASE_MS}
            WHERE job_id=${fresh.id} AND result='running'`;
        const [job] = await conn<
            CopyJob[]
        >`UPDATE ai_copy_generation_jobs SET state='generating',attempts=attempts+1,
            lease_token=${lease},lease_until=${new Date(now.getTime() + GENERATION_LEASE_MS).toISOString()},updated_at=${now.toISOString()}
            WHERE id=${fresh.id} RETURNING *`;
        const [attempt] = await conn<
            { id: number }[]
        >`INSERT INTO ai_copy_generation_attempts(job_id,org_id,attempt_number,lease_token,provider,model,started_at)
            VALUES(${job.id},${job.org_id},${job.attempts},${lease},${job.policy_snapshot.provider},${job.policy_snapshot.model},${now.toISOString()}) RETURNING id`;
        return { job, attemptId: attempt.id };
    });
    if (claimed && "output" in claimed) return claimed.output!;
    if (!claimed) throw new CopyDeferredError(new Date(now.getTime() + 10_000), "문구 준비 대기");
    const { job, attemptId } = claimed;
    const controller = new AbortController();
    let timedOut = false,
        timer: ReturnType<typeof setTimeout> | undefined;
    let response: CopyProviderResponse | undefined, output: CopyOutput | undefined;
    let result: "valid" | "validation_failed" | "provider_failed" | "timeout" = "provider_failed",
        reason: string | null = null,
        retryable = false;
    const providerPromise = Promise.resolve().then(() =>
        deps.call(
            job.policy_snapshot,
            buildCopyPrompt(
                job.policy_snapshot,
                job.knowledge_snapshot,
                job.context,
                job.validation_failures ? (job.reason ?? "형식 확인") : undefined,
            ),
            controller.signal,
        ),
    );
    providerPromise.then(
        (value) => {
            if (timedOut && deps.late) void deps.late(attemptId, value).catch(() => undefined);
        },
        () => undefined,
    );
    try {
        response = await Promise.race([
            providerPromise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(new CopyProviderError("provider_timeout", true));
                }, deps.timeoutMs ?? 45_000);
            }),
        ]);
        try {
            if (response.truncated) throw new Error("출력 토큰 한도 초과");
            output = validateCopy(job.policy_snapshot, job.context, parseCopyOutput(response.content));
            result = "valid";
        } catch (error) {
            result = "validation_failed";
            reason = error instanceof Error ? error.message : "출력 검증 실패";
            retryable = job.validation_failures === 0;
        }
    } catch (error) {
        result = timedOut ? "timeout" : "provider_failed";
        reason = error instanceof CopyProviderError ? error.code : "provider_network";
        retryable = error instanceof CopyProviderError ? error.retryable : true;
    } finally {
        if (timer) clearTimeout(timer);
    }
    const finished = deps.now(),
        duration = Math.max(0, finished.getTime() - now.getTime());
    await conn`UPDATE ai_copy_generation_attempts SET result=${result},reason=${reason},raw_output=${response?.content.slice(0, 30_000) ?? null},
        finished_at=${finished.toISOString()},duration_ms=${duration},output_fingerprint=${output?.fingerprint ?? null} WHERE id=${attemptId} AND result='running'`;
    if (response) await recordAttemptUsage(conn, attemptId, response);
    // 차단과 타임아웃 후에는 늦게 완성한 본문으로 상태를 되돌리지 않는다.
    const blocked = await policyBlocked(conn, job);
    const [failures] = await conn<
        { count: number }[]
    >`SELECT count(*)::int AS count FROM ai_copy_generation_attempts WHERE job_id=${job.id} AND result IN ('provider_failed','timeout')`;
    // 기한은 eligible_at 이후 첫 시도부터 — 보류를 풀 때 eligible_at을 새로 잡으면 기한도 새로 시작한다
    const [windowStart] = await conn<
        { at: Date | null }[]
    >`SELECT min(started_at) AS at FROM ai_copy_generation_attempts WHERE job_id=${job.id} AND started_at>=${new Date(job.eligible_at).toISOString()}`;
    const canRetry =
        retryable &&
        failures.count <= MAX_TRANSIENT_RETRIES &&
        !passedPreparationDeadline({ attempts: job.attempts, firstAttemptAt: windowStart?.at ?? null }, finished);
    const nextState = blocked ? "held" : output ? "ready" : canRetry ? "retry" : "held";
    const retryAt = new Date(
        finished.getTime() + Math.min(300_000, 10_000 * 2 ** (job.attempts - 1)),
    );
    const [saved] = await conn<
        CopyJob[]
    >`UPDATE ai_copy_generation_jobs SET state=${nextState},output=${output && !blocked ? JSON.stringify(output) : null}::jsonb,
        ready_at=${output && !blocked ? finished.toISOString() : null},reason=${blocked ? "blocked_version" : reason},lease_until=NULL,lease_token=NULL,
        validation_failures=validation_failures+${result === "validation_failed" ? 1 : 0},retry_at=${canRetry ? retryAt.toISOString() : null},updated_at=${finished.toISOString()}
        WHERE id=${job.id} AND lease_token=${lease} AND state='generating' RETURNING *`;
    if (saved?.state === "ready" && saved.output) return saved.output;
    throw new CopyDeferredError(
        canRetry ? retryAt : new Date(finished.getTime() + 3600_000),
        saved?.reason ?? "검토 대기",
        !canRetry,
    );
}
