import { randomUUID } from "node:crypto";
import type { CopyConnection, PolicySnapshot } from "./types";
import type { GenerationDeps } from "./generation";
import {
    copyTransaction,
    CopyDeferredError,
    ensureGenerationJob,
    recordAttemptUsage,
} from "./generation";
import { AUTO_DAILY_CALLS, AUTO_DAILY_TOKENS, parseAutoJson } from "./automation-rules";
import type { CopyProviderResponse } from "./provider";

export async function requireAutomaticBudget(
    conn: CopyConnection,
    orgId: string,
    now: Date,
    deps: GenerationDeps,
) {
    const day = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(`${day}T00:00:00+09:00`).toISOString();
    const [usage] = await conn<
        { calls: number; tokens: number }[]
    >`SELECT count(a.id)::int AS calls,COALESCE(sum(a.charged_prompt_tokens+a.charged_completion_tokens),0)::bigint AS tokens
        FROM ai_copy_generation_attempts a JOIN ai_copy_generation_jobs j ON j.id=a.job_id WHERE j.org_id=${orgId} AND j.idempotency_key LIKE 'evaluation:auto:%' AND a.started_at>=${from}`;
    if (
        usage.calls >= AUTO_DAILY_CALLS ||
        Number(usage.tokens) >= AUTO_DAILY_TOKENS ||
        !(await deps.quota(orgId))
    )
        throw new CopyDeferredError(
            new Date(now.getTime() + 3600_000),
            "자동 준비 사용량 한도: 다음 회차에 재개합니다.",
        );
}

/** 이메일 생성과 같은 사용량 장부를 사용하며, 성공한 자동 작업은 다시 호출하지 않는다. */
export async function callAutomationTask(
    conn: CopyConnection,
    input: {
        orgId: string;
        workspaceId: number;
        cycleId: number;
        key: string;
        kind: "candidate" | "review" | "reply";
        policy: PolicySnapshot;
        prompt: { system: string; user: string };
    },
    deps: GenerationDeps,
) {
    const key = `evaluation:auto:${input.cycleId}:${input.key}`;
    const callPolicy = {
        ...input.policy,
        parameters: {
            ...input.policy.parameters,
            maxOutputTokens: input.kind === "candidate" ? 4096 : 1024,
            temperature: 0.2,
        },
    };
    const job = await ensureGenerationJob(conn, {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        purpose: input.policy.purpose,
        key,
        policy: callPolicy,
        knowledge: null,
        context: input.prompt,
        eligibleAt: deps.now(),
    });
    const [stored] = await conn<
        { result: unknown }[]
    >`SELECT result FROM ai_copy_automation_calls WHERE job_id=${job.id}`;
    if (stored?.result !== null && stored?.result !== undefined) return stored.result;
    if (job.state === "held" || job.state === "cancelled")
        throw new Error("자동 준비 호출을 완료하지 못했습니다. 기존 지침을 유지합니다.");
    const now = deps.now();
    if (job.state === "generating") {
        if (job.lease_until && new Date(job.lease_until) > now)
            throw new CopyDeferredError(new Date(now.getTime() + 60000), "자동 준비 진행 중");
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='자동 호출 결과 불명확' WHERE id=${job.id}`;
        await conn`UPDATE ai_copy_generation_attempts SET result='timeout',finished_at=${now.toISOString()},reason='automation_lease_expired' WHERE job_id=${job.id} AND result='running'`;
        throw new Error("자동 호출 결과 불명확: 자동 재호출 없이 기존 지침을 유지합니다.");
    }
    await requireAutomaticBudget(conn, input.orgId, now, deps);
    const lease = randomUUID();
    const attempt = await copyTransaction(conn, async () => {
        const [claim] =
            await conn`UPDATE ai_copy_generation_jobs SET state='generating',attempts=1,lease_token=${lease},lease_until=${new Date(now.getTime() + 60000).toISOString()} WHERE id=${job.id} AND state='pending' RETURNING id`;
        if (!claim)
            throw new CopyDeferredError(
                new Date(now.getTime() + 60000),
                "다른 자동 준비 작업이 진행 중입니다.",
            );
        await conn`INSERT INTO ai_copy_automation_calls(job_id,cycle_id,kind) VALUES(${job.id},${input.cycleId},${input.kind}) ON CONFLICT DO NOTHING`;
        const [a] = await conn<
            { id: number }[]
        >`INSERT INTO ai_copy_generation_attempts(job_id,org_id,attempt_number,lease_token,provider,model,started_at) VALUES(${job.id},${input.orgId},1,${lease},${input.policy.provider},${input.policy.model},${now.toISOString()}) RETURNING id`;
        return a;
    });
    const controller = new AbortController();
    let timedOut = false,
        timer: ReturnType<typeof setTimeout> | undefined;
    const calling = deps.call(callPolicy, input.prompt, controller.signal);
    void calling
        .then(async (response) => {
            if (timedOut) {
                if (deps.late) await deps.late(attempt.id, response);
                else await recordAttemptUsage(conn, attempt.id, response, true);
            }
        })
        .catch(() => {});
    let response: CopyProviderResponse | undefined;
    try {
        response = await Promise.race([
            calling,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    reject(new Error("자동 준비 응답 시간 초과"));
                }, deps.timeoutMs ?? 45000);
            }),
        ]);
        await recordAttemptUsage(conn, attempt.id, response);
        if (response.promptTokens === null || response.completionTokens === null)
            throw new Error("자동 준비 사용량을 확인할 수 없습니다.");
        if (response.truncated) throw new Error("자동 준비 응답이 잘렸습니다.");
        const result = parseAutoJson(response.content);
        if (result === null || typeof result !== "object")
            throw new Error("자동 준비 JSON 객체가 필요합니다.");
        await copyTransaction(conn, async () => {
            await conn`UPDATE ai_copy_automation_calls SET result=${JSON.stringify(result)}::jsonb WHERE job_id=${job.id}`;
            await conn`UPDATE ai_copy_generation_attempts SET result='valid',finished_at=${deps.now().toISOString()},duration_ms=${Math.max(0, deps.now().getTime() - now.getTime())} WHERE id=${attempt.id}`;
            await conn`UPDATE ai_copy_generation_jobs SET state='ready',ready_at=${deps.now().toISOString()},lease_until=NULL,lease_token=NULL WHERE id=${job.id}`;
        });
        return result;
    } catch (error) {
        await conn`UPDATE ai_copy_generation_attempts SET result=${timedOut ? "timeout" : "provider_failed"},finished_at=${deps.now().toISOString()},duration_ms=${Math.max(0, deps.now().getTime() - now.getTime())},reason='automation_call_failed' WHERE id=${attempt.id}`;
        await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='자동 준비 실패',lease_until=NULL,lease_token=NULL WHERE id=${job.id}`;
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
