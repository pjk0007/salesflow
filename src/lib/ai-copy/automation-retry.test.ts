// UX-246 — 자동 준비 AI 호출의 일시 실패(잘림·시간 초과·형식 오류)는 회차를 바로 '준비 보류'로 끝내지 않고
// 같은 작업을 나중에 다시 시도한다. 상한을 넘으면 기존처럼 보류. 보류 회차는 '다시 준비'·규칙 변경 시 7일 대기 없이 새 회차.
// 실제 DB·모델 없이 원시 SQL 연결을 상태 기계로 흉내 낸다.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../auth-fake-db.test-helper";
import type { GenerationDeps } from "./generation";
import type { CopyConnection, PolicySnapshot } from "./types";
import type { CopyProviderResponse } from "./provider";

type Row = Record<string, unknown>;
// db 모듈이 접속값을 요구하므로 가상 환경을 먼저 세운 뒤 불러온다(실제 접속은 하지 않는다).
async function load(t: TestContext) {
    isolateEnv(t);
    return {
        ...(await import("./automation-calls")),
        ...(await import("./automation-worker")),
        ...(await import("./generation")),
    };
}
const ORG = "00000000-0000-4000-8000-000000000001";

function fakeConn(handle: (sql: string, values: unknown[]) => Row[] | undefined) {
    const log: string[] = [];
    const conn = Object.assign(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = strings.join("?");
            log.push(sql);
            return handle(sql, values) ?? [];
        },
        { release() {} },
    );
    return { conn: conn as unknown as CopyConnection, log };
}

function jobConn() {
    const job: Row = { id: 7, workspace_id: 3, purpose: "visit_ack", state: "pending", retry_at: null, lease_until: null };
    const attempts: { result: string }[] = [];
    let stored: unknown = null;
    const { conn } = fakeConn((sql, values) => {
        if (sql.includes("INSERT INTO ai_copy_generation_jobs")) return [{ ...job }];
        if (sql.includes("SELECT result FROM ai_copy_automation_calls")) return stored === null ? [] : [{ result: stored }];
        if (sql.includes("AS calls")) return [{ calls: 0, tokens: 0 }];
        if (sql.includes("SET state='generating'")) {
            const now = new Date(values.at(-1) as string);
            const due = !job.retry_at || new Date(job.retry_at as string) <= now;
            if (!["pending", "retry"].includes(job.state as string) || !due) return [];
            Object.assign(job, { state: "generating", retry_at: null });
            return [{ id: 7 }];
        }
        if (sql.includes("INSERT INTO ai_copy_generation_attempts")) {
            attempts.push({ result: "running" });
            return [{ id: attempts.length }];
        }
        if (sql.startsWith("UPDATE ai_copy_generation_attempts SET result=") && sql.includes("automation_call_failed"))
            attempts[attempts.length - 1].result = values[0] as string;
        if (sql.includes("AS failures"))
            return [{ failures: attempts.filter((a) => ["timeout", "provider_failed"].includes(a.result)).length }];
        if (sql.includes("SET state='retry'")) Object.assign(job, { state: "retry", retry_at: values[0] });
        if (sql.includes("SET state='held'")) job.state = "held";
        if (sql.includes("UPDATE ai_copy_automation_calls SET result=")) stored = JSON.parse(values[0] as string);
        if (sql.includes("SET state='ready'")) job.state = "ready";
        return undefined;
    });
    return { conn, job, attempts };
}

const policy = { purpose: "visit_ack", provider: "claude", model: "claude-haiku-4-5", parameters: {} } as unknown as PolicySnapshot;
const input = { orgId: ORG, workspaceId: 3, cycleId: 9, key: "review:0", kind: "review" as const, policy, prompt: { system: "가상", user: "가상" } };
const reply = (over: Partial<CopyProviderResponse> = {}): CopyProviderResponse =>
    ({ content: '{"ok":true}', promptTokens: 10, completionTokens: 5, truncated: false, ...over }) as CopyProviderResponse;

function depsWith(responses: (() => Promise<CopyProviderResponse>)[], clock: { now: Date }) {
    let calls = 0;
    const deps: GenerationDeps = {
        now: () => new Date(clock.now),
        quota: async () => true,
        call: async () => responses[Math.min(calls++, responses.length - 1)](),
        timeoutMs: 20,
    };
    return { deps, calls: () => calls };
}

test("UX-246 일시 실패는 회차를 유지한 채 재시도 예약, 상한을 넘으면 기존처럼 보류", async (t) => {
    const { callAutomationTask, AUTO_CALL_MAX_ATTEMPTS, CopyDeferredError } = await load(t);
    const { conn, job } = jobConn();
    const clock = { now: new Date("2026-10-25T01:00:00Z") };
    const { deps, calls } = depsWith(
        [async () => reply({ truncated: true }), async () => reply({ content: "JSON 아님" }), async () => reply({ truncated: true })],
        clock,
    );
    // 1회 실패 → 지연(회차 유지), 작업은 retry, 10분 뒤
    const first = await callAutomationTask(conn, input, deps).catch((e) => e);
    assert.ok(first instanceof CopyDeferredError && !first.held, "CopyDeferredError(회차 유지)");
    assert.match(first.reason, /1\/3회/);
    assert.equal(job.state, "retry");
    assert.equal(new Date(job.retry_at as string).getTime() - clock.now.getTime(), 10 * 60_000);
    // 재시도 시각 전에는 공급자를 부르지 않는다
    clock.now = new Date(clock.now.getTime() + 60_000);
    const early = await callAutomationTask(conn, input, deps).catch((e) => e);
    assert.ok(early instanceof CopyDeferredError);
    assert.match(early.reason, /재시도 대기/);
    assert.equal(calls(), 1);
    // 2회 실패(형식 오류) → 다시 지연, 20분 뒤
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    const second = await callAutomationTask(conn, input, deps).catch((e) => e);
    assert.ok(second instanceof CopyDeferredError);
    assert.match(second.reason, /2\/3회/);
    assert.equal(new Date(job.retry_at as string).getTime() - clock.now.getTime(), 20 * 60_000);
    // 3회째 실패 → 상한, 기존처럼 보류(일반 오류 → 작업기가 blocked 처리)
    clock.now = new Date(clock.now.getTime() + 20 * 60_000);
    const third = await callAutomationTask(conn, input, deps).catch((e) => e);
    assert.equal(AUTO_CALL_MAX_ATTEMPTS, 3);
    assert.ok(!(third instanceof CopyDeferredError), "상한 초과는 지연이 아니다");
    assert.equal(job.state, "held");
    assert.equal(calls(), 3);
});

test("UX-246 실패 뒤 다시 시도해 성공하면 결과를 저장하고 끝난다", async (t) => {
    const { callAutomationTask, CopyDeferredError } = await load(t);
    const { conn, job } = jobConn();
    const clock = { now: new Date("2026-10-25T01:00:00Z") };
    const { deps } = depsWith(
        [() => new Promise<CopyProviderResponse>(() => {}), async () => reply()],
        clock,
    );
    const timeout = await callAutomationTask(conn, input, deps).catch((e) => e);
    assert.ok(timeout instanceof CopyDeferredError);
    assert.match(timeout.reason, /응답 시간 초과/);
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    assert.deepEqual(await callAutomationTask(conn, input, deps), { ok: true });
    assert.equal(job.state, "ready");
});

test("UX-246 보류 회차: '다시 준비'(last_error 비움)면 7일 대기 없이 새 회차, 아니면 대기 유지", async (t) => {
    const { processCopyAutomation } = await load(t);
    for (const [name, lastError, expectCooldown] of [
        ["다시 준비 후", null, false],
        ["보류 직후", "자동 준비를 완료하지 못했습니다.", true],
    ] as const) {
        await t.test(name, async () => {
            const now = new Date("2026-10-25T01:00:00Z");
            const setting = { id: 1, org_id: ORG, workspace_id: 3, purpose: "visit_ack", rule_id: 0, enabled: true, experiment_mode: "auto", actor_id: "u", next_run_at: now, last_error: lastError };
            const { conn, log } = fakeConn((sql) => {
                if (sql.includes("pg_try_advisory_lock")) return [{ locked: true }];
                if (sql.includes("SELECT s.* FROM ai_copy_automation_settings")) return [setting];
                if (sql.includes("stage NOT IN('applied','declined','blocked')")) return [];
                if (sql.includes("SELECT updated_at,stage,rule_fingerprint")) return [{ updated_at: new Date(now.getTime() - 3600_000), stage: "blocked", rule_fingerprint: null }];
                return undefined;
            });
            const result = await processCopyAutomation({
                conn,
                deps: { now: () => now, quota: async () => true, call: async () => reply() },
            });
            assert.equal("cooldown" in result && result.cooldown === true, expectCooldown);
            assert.equal(log.some((s) => s.includes("FROM ai_copy_bindings")), !expectCooldown, "새 회차 준비 시작 여부");
        });
    }
});
