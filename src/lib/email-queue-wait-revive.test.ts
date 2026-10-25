/**
 * UX-228·259: 규칙을 잠시 끄거나 월 AI 한도에 닿은 대기열 줄을 닫지 않고 held로 두었다가,
 * 규칙을 다시 켜거나 한도가 풀리면 되살리는지 — 가상 db·가상 연결로 워커 회차(종료 뒤 다음 회차 재개)를 따라간다.
 * 실제 DB·AI·NHN은 부르지 않는다 (fetch는 부르면 실패하게 막고 횟수만 센다).
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";
import type { CopyConnection, CopyJob } from "./ai-copy/types";

const orgId = "00000000-0000-4000-8000-000000000001";
const otherOrg = "00000000-0000-4000-8000-000000000009";
const userId = "00000000-0000-4000-8000-000000000002";

/** 대기열 한 줄을 들고 있는 작은 모형 — 워커가 쓰는 SQL을 그 뜻대로 흉내 낸다 */
interface Row {
    id: number;
    status: string;
    last_error: string | null;
    attempts: number;
    priority: number;
}

function blockFetch(t: TestContext) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
        calls++;
        throw new Error("must not call external services");
    });
    return () => calls;
}

async function queueFixture(t: TestContext, state: { rulesActive: boolean; rulesExist: boolean; row: Row }) {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        const row = state.row;
        if (c.op === "select" && c.table === "email_send_queue") return []; // 멈춘 줄 없음
        if (c.op === "select" && c.table === "records") {
            return [{ id: 50, partitionId: 3, orgId, data: { email: "not-an-email" }, createdAt: new Date(), updatedAt: new Date() }];
        }
        if (c.op === "select" && c.table === "email_auto_personalized_links") {
            const activeOnly = c.sql.includes('"is_active"');
            if (activeOnly) {
                return state.rulesActive
                    ? [{ id: 7, partitionId: 3, triggerType: "on_create", recipientField: "email", triggerCondition: null, isActive: 1, preventDuplicate: 0 }]
                    : [];
            }
            return state.rulesExist ? [{ id: 7 }] : [];
        }
        if (c.op === "execute") {
            if (c.sql.includes("SELECT DISTINCT q.org_id")) return [];
            // 되살리기: held 줄 중 앞머리 조건이 맞는 줄만 pending으로
            if (c.sql.includes("UPDATE email_send_queue q SET status = 'pending'")) {
                const rulesOk = state.rulesActive || !state.rulesExist;
                if (row.status === "held" && row.last_error?.startsWith("held(rules_inactive)") && rulesOk) {
                    row.status = "pending";
                    return [{ id: row.id }];
                }
                return [];
            }
            // 꺼내기
            if (c.sql.includes("SET status = 'processing'")) {
                if (row.status !== "pending") return [];
                row.status = "processing";
                row.attempts++;
                return [{ id: row.id, record_id: 50, partition_id: 3, org_id: orgId, trigger_type: "on_create", attempts: row.attempts, exhausted_link_ids: null, priority: row.priority }];
            }
            // 처리 결과 쓰기 (applyPlans) — held는 앞머리 있는 문구만 남긴다
            if (c.sql.includes("jsonb_to_recordset")) {
                const writes = JSON.parse(String(c.params.find((p) => typeof p === "string" && p.startsWith("[")))) as Array<{
                    id: number; status: string; attempts: number; last_error: string | null;
                }>;
                for (const w of writes) {
                    if (w.id !== row.id) continue;
                    row.status = w.status;
                    row.attempts = w.attempts;
                    if (!(w.status === "held" && !(w.last_error ?? "").startsWith("held("))) row.last_error = w.last_error;
                }
                return [];
            }
        }
        return [];
    });
    const connection = Object.assign(async () => [{ acquired: true }], { release() {} });
    t.mock.method(queryClient, "reserve", async () => connection as never);
    const { processEmailSendQueue } = await import("./email-send-queue");
    return { calls, run: () => processEmailSendQueue() };
}

test("UX-228: 규칙을 끈 동안 처리 시점이 온 줄은 held(사유)로 남고, 다시 켜면 다음 회차에 되살아나 원래 규칙으로 처리된다", async (t) => {
    const externalCalls = blockFetch(t);
    const state = { rulesActive: false, rulesExist: true, row: { id: 1, status: "pending", last_error: "deferred(daily_limit) until …", attempts: 0, priority: 0 } };
    const f = await queueFixture(t, state);

    // 1회차: 규칙이 모두 꺼져 있다 → skipped로 닫지 않고 held, 시도 횟수도 쓰지 않는다
    const first = await f.run();
    assert.equal(first.held, 1);
    assert.equal(first.skipped, 0);
    assert.equal(state.row.status, "held");
    assert.equal(state.row.attempts, 0);
    assert.match(state.row.last_error ?? "", /^held\(rules_inactive\): /);

    // 프로세스가 끝나고 다음 회차가 와도 규칙이 꺼져 있으면 그대로 held (꺼내지도 않는다)
    const idle = await f.run();
    assert.equal(idle.picked, 0);
    assert.equal(state.row.status, "held");

    // 규칙을 다시 켠다 → 다음 회차 첫머리의 되살리기가 pending으로 돌리고 같은 회차에 켜진 규칙으로 처리한다
    state.rulesActive = true;
    const resumed = await f.run();
    assert.equal(resumed.picked, 1);
    // 가상 레코드의 받는 주소가 메일 모양이 아니어서 켜진 규칙이 invalid_email로 건너뛴다 — 규칙이 실제로 돌았다는 증거
    assert.equal(state.row.status, "skipped");
    assert.match(state.row.last_error ?? "", /link 7: skipped \(invalid_email\)/);
    assert.equal(externalCalls(), 0);
});

test("UX-228: 규칙이 삭제됐으면 기존처럼 '규칙 없음'으로 닫는다 (held로 붙잡지 않는다)", async (t) => {
    blockFetch(t);
    const state = { rulesActive: false, rulesExist: false, row: { id: 2, status: "pending", last_error: null, attempts: 0, priority: 1 } };
    const f = await queueFixture(t, state);
    const stats = await f.run();
    assert.equal(stats.skipped, 1);
    assert.equal(state.row.status, "skipped");
    assert.equal(state.row.last_error, "no matching rules");
});

test("UX-228: 끈 동안 held였던 줄의 규칙이 모두 지워지면 되살린 뒤 '규칙 없음'으로 닫아 영구 보류로 남기지 않는다", async (t) => {
    blockFetch(t);
    const state = {
        rulesActive: false,
        rulesExist: false,
        row: { id: 3, status: "held", last_error: "held(rules_inactive): 켜진 AI 자동발송 규칙이 없어 보류", attempts: 0, priority: 0 },
    };
    const f = await queueFixture(t, state);
    await f.run();
    assert.equal(state.row.status, "skipped");
});

test("UX-228·259: 되살리기 SQL — 명단 보류 없음·켜진 규칙·한도 열린 조직만, 바로 보내는 문의 줄은 명단 보류와 무관", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { calls } = installFakeDb(t, db, (c) => {
        if (c.op === "execute" && c.sql.includes("SELECT DISTINCT q.org_id")) return [{ org_id: orgId }, { org_id: otherOrg }];
        return [];
    });
    const { reviveOrphanHeldRows } = await import("./partition-hold");
    const asked: string[] = [];
    await reviveOrphanHeldRows("send_queue", {
        quotaOpen: async (id) => {
            asked.push(id);
            return id === orgId; // 다른 조직은 아직 한도 안
        },
    });
    assert.deepEqual(asked, [orgId, otherOrg]);
    const update = calls.find((c) => c.op === "execute" && c.sql.includes("UPDATE email_send_queue q"))!;
    assert.match(update.sql, /q\.priority <> 0 OR NOT EXISTS/);
    assert.match(update.sql, /a\.is_active = 1/);
    assert(update.params.includes("held(rules_inactive)%"));
    assert(update.params.includes("held(quota_exceeded)%"));
    // 한도가 풀린 조직만 되살린다
    const orgList = update.params.find((p) => Array.isArray(p)) as string[];
    assert.deepEqual(orgList, [orgId]);

    // quotaOpen을 넘기지 않으면 한도 보류는 되살리지 않는다 (빈 목록)
    calls.length = 0;
    await reviveOrphanHeldRows("send_queue");
    assert(!calls.some((c) => c.sql.includes("SELECT DISTINCT q.org_id")));
    assert.deepEqual(calls.find((c) => c.sql.includes("UPDATE email_send_queue q"))!.params.find((p) => Array.isArray(p)), []);
});

// ── 생성 계층: 한도 보류 작업의 자동 재개 (UX-259) ──

function fakeCopyConn(job: Partial<CopyJob>) {
    const statements: string[] = [];
    const conn = (async (strings: TemplateStringsArray) => {
        const text = strings.join("?");
        statements.push(text);
        if (text.startsWith("SELECT * FROM ai_copy_generation_jobs WHERE id=") && !text.includes("FOR UPDATE")) return [job];
        if (text.includes("AS blocked")) return [{ blocked: false }];
        // 재개 뒤 선점 단계: 다른 작업자가 잡고 있는 것으로 두어 실제 생성(모델 호출)까지 가지 않게 한다
        if (text.includes("FOR UPDATE")) return [{ ...job, state: "generating", lease_until: new Date("2099-01-01T00:00:00Z") }];
        return [];
    }) as unknown as CopyConnection;
    return { conn, statements };
}

const heldJob: Partial<CopyJob> = {
    id: 41, org_id: orgId, state: "held", reason: "token_quota", origin: "operational", assignment_id: null, output: null,
};

test("UX-259: 한도 보류 작업은 한도가 그대로면 token_quota로 계속 보류, 풀리면 수동 재개와 같은 갱신으로 이어서 만든다", async () => {
    const { generateStoredCopy, CopyDeferredError } = await import("./ai-copy/generation");
    const deps = (allowed: boolean) => ({
        now: () => new Date("2026-11-01T00:00:00Z"),
        quota: async () => allowed,
        call: async () => {
            throw new Error("model must not be called");
        },
    });

    const still = fakeCopyConn(heldJob);
    await assert.rejects(generateStoredCopy(still.conn, { id: 41, orgId }, deps(false)), (e: unknown) => {
        assert(e instanceof CopyDeferredError);
        assert.equal(e.code, "token_quota");
        assert.equal(e.held, true);
        assert.equal(e.reason, "AI 사용 한도");
        return true;
    });
    assert(!still.statements.some((s) => s.includes("SET state='pending'")), "한도가 그대로면 상태를 바꾸지 않는다");

    const open = fakeCopyConn(heldJob);
    await assert.rejects(generateStoredCopy(open.conn, { id: 41, orgId }, deps(true)), (e: unknown) => {
        assert(e instanceof CopyDeferredError, String(e instanceof Error ? e.stack : e));
        assert.equal(e.code, undefined, "더 이상 한도 보류가 아니다");
        assert.equal(e.held, false);
        return true;
    });
    const resume = open.statements.find((s) => s.includes("SET state='pending'"));
    assert(resume, "한도가 풀리면 pending으로 되돌린다");
    assert.match(resume!, /WHERE id=\? AND state='held' AND reason='token_quota'/);
});

test("UX-259: 실험 고정 작업·평가 작업의 한도 보류는 기존대로 수동 재개(자동 재개 없음)", async () => {
    const { generateStoredCopy, CopyDeferredError } = await import("./ai-copy/generation");
    const deps = { now: () => new Date(), quota: async () => true, call: async () => { throw new Error("no"); } };
    for (const job of [{ ...heldJob, assignment_id: 5 }, { ...heldJob, origin: "evaluation" as const }]) {
        const f = fakeCopyConn(job);
        await assert.rejects(generateStoredCopy(f.conn, { id: 41, orgId }, deps), (e: unknown) => e instanceof CopyDeferredError && e.code === "token_quota");
        assert(!f.statements.some((s) => s.includes("SET state='pending'")));
    }
});

// ── 규칙 켜기·끄기 API (UX-228) ──

async function ruleRoute(t: TestContext, opts: { wasActive: number; nowActive: number; otherActive: boolean; waiting: number }) {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test", CRON_SECRET: "test-only" });
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { PUT } = await import("../app/api/email/auto-personalized/[id]/route");
    let woke = 0;
    t.mock.method(globalThis, "fetch", async (url: unknown) => {
        if (String(url).includes("/api/email/queue/process")) woke++;
        return new Response("{}");
    });
    const { calls } = installFakeDb(t, db, (c) => {
        if (isMembershipLookup(c)) return [{ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "email_auto_personalized_links") {
            return c.sql.includes('"is_active"') ? (opts.otherActive ? [{ id: 8 }] : []) : [{ id: 7, orgId, partitionId: 3, triggerType: "on_create", isActive: opts.wasActive, isDraft: 0 }];
        }
        if (c.op === "update" && c.table === "email_auto_personalized_links") return [{ id: 7, orgId, partitionId: 3, triggerType: "on_create", isActive: opts.nowActive, isDraft: 0 }];
        if (c.op === "select" && c.table === "email_send_queue") return [{ count: opts.waiting }];
        if (c.op === "execute" && c.sql.includes("UPDATE email_send_queue q")) return [{ id: 1 }, { id: 2 }];
        return [];
    });
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "admin", membershipId: 71, tokenVersion: 0 });
    const response = await PUT(
        new NextRequest("https://example.test/api/email/auto-personalized/7", {
            method: "PUT",
            headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: opts.nowActive }),
        }),
        { params: Promise.resolve({ id: "7" }) }
    );
    await new Promise((r) => setTimeout(r, 0));
    return { response, body: await response.json(), calls, woke: () => woke };
}

test("UX-228: 규칙을 다시 켜면 그 조직·파티션의 보류 줄만 되살리고 워커를 깨운다", async (t) => {
    const r = await ruleRoute(t, { wasActive: 0, nowActive: 1, otherActive: false, waiting: 0 });
    assert.equal(r.response.status, 200);
    const revive = r.calls.find((c) => c.op === "execute" && c.sql.includes("UPDATE email_send_queue q"))!;
    assert(revive, "켜기 직후 되살리기");
    assert(revive.params.includes(orgId) && revive.params.includes(3), "그 조직·파티션 범위");
    assert.equal(r.woke(), 1);
});

test("UX-228: 마지막 켜진 규칙을 끄면 보류될 대기 수를 알려 주고, 다른 켜진 규칙이 있으면 알리지 않는다", async (t) => {
    const last = await ruleRoute(t, { wasActive: 1, nowActive: 0, otherActive: false, waiting: 12 });
    assert.equal(last.body.queueWaiting, 12);
    assert(!last.calls.some((c) => c.op === "execute" && c.sql.includes("UPDATE email_send_queue q")), "끌 때는 되살리지 않는다");
});

test("UX-228: 같은 파티션·트리거에 다른 켜진 규칙이 있으면 대기는 그대로 나가므로 안내하지 않는다", async (t) => {
    const other = await ruleRoute(t, { wasActive: 1, nowActive: 0, otherActive: true, waiting: 12 });
    assert.equal(other.body.queueWaiting, undefined);
});

// ── 줄마다 처리 경로: 생성 계층이 한도로 막으면 대기열 줄은 held, 바로 보내는 경로는 예전처럼 미룸 (UX-259) ──

async function perRowFixture(t: TestContext) {
    isolateEnv(t);
    const { db, queryClient } = await import("./db");
    const { calls } = installFakeDb(t, db, (c) => {
        if (c.op === "select" && c.table === "email_auto_personalized_links") {
            return [{ id: 7, partitionId: 3, triggerType: "on_create", recipientField: "email", companyField: "company", triggerCondition: null, isActive: 1, preventDuplicate: 0, autoResearch: 0, useSignaturePersona: 0, useUnsubscribe: 0, format: "plain" }];
        }
        if (c.op === "select" && c.table === "partitions") return [{ workspaceId: 2 }];
        if (c.op === "select" && c.table === "workspaces") return [{ orgId, id: 2 }];
        if (c.op === "select" && c.table === "email_configs") return [{ fromEmail: "sender@example.test", fromName: "가상", appKey: "fake", secretKey: "fake", isActive: 1 }];
        if (c.op === "select" && c.table === "ai_usage_quotas") return [{ id: 1, orgId, month: "2026-10", totalTokens: 100_000, quotaLimit: 100_000 }] // 무료 기본 한도를 다 씀;
        return [];
    });
    const copyJob = { ...heldJob, state: "pending", reason: null, eligible_at: new Date(), workspace_id: 2, purpose: "initial_email" };
    const copySql: string[] = [];
    const conn = Object.assign(
        async (strings: TemplateStringsArray) => {
            const text = strings.join("?");
            copySql.push(text);
            if (text.includes("WITH RECURSIVE chain")) return [copyJob];
            if (text.startsWith("SELECT * FROM ai_copy_generation_jobs WHERE id=")) return [copyJob];
            if (text.includes("AS blocked")) return [{ blocked: false }];
            if (text.includes("AS present")) return [{ present: false }]; // 문구 실험 없음
            return [];
        },
        { release() {} }
    );
    t.mock.method(queryClient, "reserve", async () => conn as never);
    const { processAutoPersonalizedEmail } = await import("./auto-personalized-email");
    const record = { id: 50, partitionId: 3, orgId, data: { email: "kim@example.test", company: "가나다" }, createdAt: new Date(), updatedAt: new Date() };
    return { calls, copySql, run: (queueId?: number) => processAutoPersonalizedEmail({ record: record as never, partitionId: 3, orgId, triggerType: "on_create", queueId }) };
}

test("UX-259: 줄마다 처리 중 월 AI 한도에 닿으면 대기열 줄은 held(quota_exceeded), 생성 작업은 token_quota 보류", async (t) => {
    const externalCalls = blockFetch(t);
    const f = await perRowFixture(t);
    const result = await f.run(9);
    assert.deepEqual(result.held, { waitReason: "quota_exceeded" });
    const { toProcessedRow, planQueueRow } = await import("./email-send-queue-rules");
    const processed = toProcessedRow(result);
    assert.equal(processed.outcome, "hold");
    assert.equal(planQueueRow({ outcome: processed.outcome, attempts: 1, deferral: null, failedLinkIds: [], exhaustedLinkIds: [] }).status, "held");
    assert(f.copySql.some((s) => s.includes("SET state='held',reason='token_quota'")), "생성 작업도 한도 보류로 남긴다");
    assert.equal(externalCalls(), 0);
});

test("UX-259: 바로 보내는 경로(대기열 줄 아님)는 한도에 닿아도 예전처럼 미뤄 대기열로 넘긴다", async (t) => {
    blockFetch(t);
    const f = await perRowFixture(t);
    const result = await f.run(undefined);
    assert.equal(result.held, undefined);
    assert.equal(result.outcomes[0]?.kind, "deferred");
});
