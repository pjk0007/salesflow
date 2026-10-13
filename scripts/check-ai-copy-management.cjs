/* eslint-disable @typescript-eslint/no-require-imports -- 외부 연결 없는 격리 PostgreSQL 검증 */
// node --import tsx scripts/check-ai-copy-management.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(
    path.resolve(__dirname, "../.testenv/test-runtime/node_modules/@electric-sql/pglite"),
);
const {
    ensureGenerationJob,
    generateStoredCopy,
    recordAttemptUsage,
    CopyDeferredError,
} = require("../src/lib/ai-copy/generation.ts");
const { CopyProviderError } = require("../src/lib/ai-copy/provider.ts");
const { targetsFor, fingerprint } = require("../src/lib/ai-copy/rules.ts");
const org = "00000000-0000-4000-8000-000000000001",
    user = "00000000-0000-4000-8000-000000000003";
const policy = {
    purpose: "visit_ack",
    provider: "claude",
    model: "claude-haiku-4-5",
    parameters: { maxOutputTokens: 2048, temperature: 0.8 },
    instructions: "정중하고 자연스럽게 작성하세요.",
    requiredMeanings: ["방문 감사", "추가 문의", "전화와 답장"],
    forbiddenPhrases: [],
    maxCharacters: 600,
    validatorVersion: "copy-v1",
    targets: targetsFor("visit_ack"),
};
const good = {
    content: JSON.stringify({
        paragraphs: [
            "갑작스런 메일에도 사이트를 방문해 주셔서 감사합니다.",
            "살펴보시면서 더 궁금하셨던 점이 있으실까요?",
            "언제든 전화나 답장 주시면 친절히 안내드리겠습니다.",
        ],
    }),
    promptTokens: 100,
    completionTokens: 50,
    truncated: false,
};
async function main() {
    const pg = new PGlite();
    await pg.waitReady;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("격리 검사에서 외부 네트워크 사용 금지");
    };
    const conn = async (strings, ...params) =>
        (
            await pg.query(
                strings.reduce((s, p, i) => s + p + (i < params.length ? `$${i + 1}` : ""), ""),
                params,
            )
        ).rows;
    conn.release = () => {};
    let scenarios = 0,
        now = new Date("2026-10-14T01:00:00Z"),
        calls = 0;
    const deps = {
        now: () => now,
        quota: async () => true,
        call: async () => {
            calls++;
            return good;
        },
    };
    const create = (key) =>
        ensureGenerationJob(conn, {
            orgId: org,
            workspaceId: 8,
            purpose: "visit_ack",
            key,
            policy,
            knowledge: null,
            context: {
                system: "감사 메일",
                user: "가상 사업",
                greeting: "안녕하세요. 가상 고객님",
            },
            eligibleAt: now,
        });
    try {
        await pg.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE workspaces(id integer PRIMARY KEY);
            CREATE TABLE email_send_logs(id integer PRIMARY KEY,org_id uuid,status text,sender_profile_id integer,sender_email text,request_id text,nhn_status_code text,delivery_fail_source text);
            CREATE TABLE email_copy_assignments(id integer PRIMARY KEY,org_id uuid,experiment_id integer,send_log_id integer,actual_sender_id integer,generation_job_id integer);
            CREATE TABLE email_copy_experiments(id integer PRIMARY KEY,state text,pending_mode text);
            CREATE TABLE ai_usage_quotas(org_id uuid,month text,total_tokens bigint DEFAULT 0,quota_limit bigint DEFAULT 100000,updated_at timestamptz DEFAULT now(),UNIQUE(org_id,month));
            CREATE TABLE ai_usage_logs(id serial PRIMARY KEY,org_id uuid,provider text,model text,prompt_tokens integer,completion_tokens integer,purpose text);
            INSERT INTO organizations VALUES('${org}'); INSERT INTO users VALUES('${user}'); INSERT INTO workspaces VALUES(8),(9);`);
        const migration = fs.readFileSync(
            path.resolve(__dirname, "../drizzle/0083_ai_copy_management.sql"),
            "utf8",
        );
        for (const statement of migration.split("--> statement-breakpoint"))
            if (statement.trim()) await pg.exec(statement);
        for (const statement of fs
            .readFileSync(path.resolve(__dirname, "../drizzle/0086_ai_copy_revisions.sql"), "utf8")
            .split("--> statement-breakpoint"))
            if (statement.trim()) await pg.exec(statement);
        scenarios++;
        const job = await create("same-job");
        const pinned = await ensureGenerationJob(conn, {
            orgId: org,
            workspaceId: 8,
            purpose: "visit_ack",
            key: "same-job",
            policy: { ...policy, instructions: "바뀐 지침은 기존 고객에게 적용하지 않습니다." },
            knowledge: null,
            context: { system: "변경", user: "변경" },
        });
        assert.equal(pinned.id, job.id);
        assert.equal(pinned.policy_snapshot.instructions, policy.instructions);
        scenarios++;
        const first = await generateStoredCopy(conn, { id: job.id, orgId: org }, deps);
        const retry = await generateStoredCopy(conn, { id: job.id, orgId: org }, deps);
        assert.deepEqual(first, retry);
        assert.equal(calls, 1);
        scenarios++;
        const usage = await pg.query("SELECT * FROM ai_copy_generation_attempts WHERE job_id=$1", [
            job.id,
        ]);
        assert.equal(usage.rows[0].usage_known, true);
        assert.equal(usage.rows[0].cost, null);
        scenarios++;
        await recordAttemptUsage(conn, usage.rows[0].id, good);
        assert.equal(
            (await pg.query("SELECT total_tokens::int FROM ai_usage_quotas")).rows[0].total_tokens,
            150,
        );
        scenarios++;
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: job.id, orgId: "00000000-0000-4000-8000-000000000002" },
                deps,
            ),
            /찾을 수/,
        );
        scenarios++;
        const bad = await create("invalid-then-corrected");
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: bad.id, orgId: org },
                { ...deps, call: async () => ({ ...good, content: "bad json" }) },
            ),
            (e) => e instanceof CopyDeferredError && !e.held,
        );
        now = new Date(now.getTime() + 11_000);
        await generateStoredCopy(conn, { id: bad.id, orgId: org }, deps);
        assert.equal(
            (await pg.query("SELECT attempts FROM ai_copy_generation_jobs WHERE id=$1", [bad.id]))
                .rows[0].attempts,
            2,
        );
        scenarios++;
        const invalid = await create("invalid-held");
        const invalidDeps = { ...deps, call: async () => ({ ...good, content: "bad" }) };
        await assert.rejects(
            generateStoredCopy(conn, { id: invalid.id, orgId: org }, invalidDeps),
            CopyDeferredError,
        );
        now = new Date(now.getTime() + 11_000);
        await assert.rejects(
            generateStoredCopy(conn, { id: invalid.id, orgId: org }, invalidDeps),
            (e) => e.held,
        );
        assert.equal(
            (await pg.query("SELECT state FROM ai_copy_generation_jobs WHERE id=$1", [invalid.id]))
                .rows[0].state,
            "held",
        );
        scenarios++;
        const quota = await create("quota-held");
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: quota.id, orgId: org },
                { ...deps, quota: async () => false },
            ),
            (e) => e.held,
        );
        assert.equal(
            (await pg.query("SELECT attempts FROM ai_copy_generation_jobs WHERE id=$1", [quota.id]))
                .rows[0].attempts,
            0,
        );
        scenarios++;
        const unknown = await create("unknown-usage");
        await generateStoredCopy(
            conn,
            { id: unknown.id, orgId: org },
            {
                ...deps,
                call: async () => ({ ...good, promptTokens: null, completionTokens: null }),
            },
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT usage_known,cost FROM ai_copy_generation_attempts WHERE job_id=$1",
                    [unknown.id],
                )
            ).rows[0].usage_known,
            false,
        );
        scenarios++;
        const failed = await create("transient-error");
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: failed.id, orgId: org },
                {
                    ...deps,
                    call: async () => {
                        throw new CopyProviderError("provider_http_429", true);
                    },
                },
            ),
            (e) => !e.held,
        );
        assert.equal(
            (
                await pg.query("SELECT result FROM ai_copy_generation_attempts WHERE job_id=$1", [
                    failed.id,
                ])
            ).rows[0].result,
            "provider_failed",
        );
        scenarios++;
        const permanent = await create("permanent-error");
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: permanent.id, orgId: org },
                {
                    ...deps,
                    call: async () => {
                        throw new CopyProviderError("provider_http_401", false);
                    },
                },
            ),
            (e) => e.held,
        );
        scenarios++;
        const lateJob = await create("timeout-no-late-body");
        let lateId, lateResponse;
        await assert.rejects(
            generateStoredCopy(
                conn,
                { id: lateJob.id, orgId: org },
                {
                    ...deps,
                    timeoutMs: 5,
                    call: async () => {
                        await new Promise((r) => setTimeout(r, 25));
                        return good;
                    },
                    late: async (id, response) => {
                        lateId = id;
                        lateResponse = response;
                    },
                },
            ),
            CopyDeferredError,
        );
        await new Promise((r) => setTimeout(r, 35));
        await recordAttemptUsage(conn, lateId, lateResponse, true);
        assert.equal(
            (await pg.query("SELECT output FROM ai_copy_generation_jobs WHERE id=$1", [lateJob.id]))
                .rows[0].output,
            null,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT result,late_usage_known FROM ai_copy_generation_attempts WHERE id=$1",
                    [lateId],
                )
            ).rows[0].result,
            "timeout",
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT late_usage_known FROM ai_copy_generation_attempts WHERE id=$1",
                    [lateId],
                )
            ).rows[0].late_usage_known,
            true,
        );
        scenarios++;
        const expired = await create("expired-window");
        now = new Date(now.getTime() + 31 * 60_000);
        await assert.rejects(
            generateStoredCopy(conn, { id: expired.id, orgId: org }, deps),
            CopyDeferredError,
        );
        assert.equal(
            (
                await pg.query("SELECT state,attempts FROM ai_copy_generation_jobs WHERE id=$1", [
                    expired.id,
                ])
            ).rows[0].attempts,
            0,
        );
        scenarios++;
        await pg.query(
            "INSERT INTO ai_copy_policy_versions(org_id,workspace_id,name,purpose,snapshot,fingerprint,created_by) VALUES($1,8,'가상 버전','visit_ack',$2,$3,$4)",
            [org, JSON.stringify(policy), fingerprint(policy), user],
        );
        await assert.rejects(
            pg.query("UPDATE ai_copy_policy_versions SET snapshot='{}'::jsonb WHERE id=1"),
            /복제/,
        );
        scenarios++;
        await pg.query(
            "INSERT INTO ai_copy_price_versions(org_id,provider,model,effective_at,input_per_million,output_per_million,currency,fx_to_krw,fx_date,source_url,created_by) VALUES($1,'claude','claude-haiku-4-5','2026-10-01',1,5,'USD',1400,'2026-10-14','https://example.test/pricing',$2)",
            [org, user],
        );
        const priced = await create("priced-attempt");
        await generateStoredCopy(conn, { id: priced.id, orgId: org }, deps);
        const cost = (
            await pg.query(
                "SELECT cost::float,cost_krw::float FROM ai_copy_generation_attempts WHERE job_id=$1",
                [priced.id],
            )
        ).rows[0];
        assert.equal(cost.cost, 0.00035);
        assert.equal(cost.cost_krw, 0.49);
        scenarios++;
        const partial = await create("partial-known-usage");
        const beforePartial = (await pg.query("SELECT total_tokens::int FROM ai_usage_quotas"))
            .rows[0].total_tokens;
        await generateStoredCopy(
            conn,
            { id: partial.id, orgId: org },
            { ...deps, call: async () => ({ ...good, completionTokens: null }) },
        );
        const partialAttempt = (
            await pg.query("SELECT * FROM ai_copy_generation_attempts WHERE job_id=$1", [
                partial.id,
            ])
        ).rows[0];
        assert.equal(
            (await pg.query("SELECT total_tokens::int FROM ai_usage_quotas")).rows[0].total_tokens,
            beforePartial + 100,
        );
        assert.equal(partialAttempt.usage_known, false);
        assert.equal(partialAttempt.cost, null);
        await recordAttemptUsage(conn, partialAttempt.id, good, true);
        await recordAttemptUsage(conn, partialAttempt.id, good, true);
        assert.equal(
            (await pg.query("SELECT total_tokens::int FROM ai_usage_quotas")).rows[0].total_tokens,
            beforePartial + 150,
        );
        assert.equal(
            (
                await pg.query("SELECT completion_tokens FROM ai_usage_logs WHERE id=$1", [
                    partialAttempt.usage_log_id,
                ])
            ).rows[0].completion_tokens,
            50,
        );
        scenarios++;
        const retryLimit = await create("transient-retry-limit");
        for (let i = 0; i < 4; i++) {
            await assert.rejects(
                generateStoredCopy(
                    conn,
                    { id: retryLimit.id, orgId: org },
                    {
                        ...deps,
                        call: async () => {
                            throw new CopyProviderError("provider_http_429", true);
                        },
                    },
                ),
                (e) => e.held === (i === 3),
            );
            now = new Date(now.getTime() + 100_000);
        }
        assert.equal(
            (
                await pg.query("SELECT attempts FROM ai_copy_generation_jobs WHERE id=$1", [
                    retryLimit.id,
                ])
            ).rows[0].attempts,
            4,
        );
        scenarios++;
        console.log(
            JSON.stringify({
                passed: true,
                scenarios,
                database: "isolated PGlite",
                externalNetwork: false,
                actualCustomerSends: 0,
            }),
        );
    } finally {
        global.fetch = originalFetch;
        await pg.close();
    }
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
