/* eslint-disable @typescript-eslint/no-require-imports -- 격리 SQL·실제 API의 고객 자동화 검증, 외부 발송 없음 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runWorkflowCheck(extra) {
    return runPlatformCheck(async (ctx) => {
        const { db, pg, actor, clients, channels, contacts, repo } = ctx,
            s = require("../src/lib/db/schema.ts"),
            { eq, and, desc } = require("drizzle-orm"),
            r = require("../src/lib/customer-workflows/repository.ts"),
            {
                processWorkflowRun,
            } = require("../src/lib/customer-workflows/worker.ts"),
            {
                enqueuePlatformEvent,
            } = require("../src/lib/customer-platform/outbox.ts"),
            { emptyGroup } = require("../src/lib/customer-workflows/rules.ts");
        const now = () => new Date(Date.now() + 100000000);
        let checks = 0;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS FLOW ${++checks} ${name}`);
        };
        const request = (client, path, method = "GET", body) =>
            client.request("/api/v1/workflows" + path, method, body);
        const node = (kind, part = {}) => ({
            id: randomUUID(),
            kind,
            label: kind,
            when: emptyGroup,
            ...part,
        });
        async function event(name = "workflow.qa", contact = contacts.dh) {
            return clients.dh.track(8, contact.id, {
                eventId: randomUUID(),
                name,
                properties: { tier: "A" },
            });
        }
        async function source(name = "workflow.qa") {
            const rows = await db
                .select()
                .from(s.platformEvents)
                .where(
                    and(
                        eq(s.platformEvents.workspaceId, 8),
                        eq(s.platformEvents.type, "customer.event"),
                    ),
                )
                .orderBy(desc(s.platformEvents.sequence));
            return rows.find((e) => e.payload.data.event.name === name);
        }
        async function create(
            steps,
            types = ["customer.event"],
            name = "가상 자동화",
        ) {
            return request(clients.dh, "", "POST", {
                workspaceId: 8,
                version: 0,
                name,
                description: "가상 고객 QA",
                definition: {
                    trigger: {
                        types,
                        eventName:
                            types[0] === "customer.event" ? "workflow.qa" : "",
                        when: emptyGroup,
                    },
                    steps,
                },
            });
        }
        async function publish(created, src) {
            const preview = await request(
                clients.dh,
                "/" + created.workflow.id,
                "POST",
                {
                    action: "preview",
                    revisionId: created.revision.id,
                    eventId: src.id,
                },
            );
            await request(clients.dh, "/" + created.workflow.id, "POST", {
                action: "publish",
                version: created.workflow.version,
                revisionId: created.revision.id,
                previewId: preview.id,
                allowCustomerReplies: true,
            });
            return preview;
        }
        async function runs(workflowId) {
            return db
                .select()
                .from(s.customerWorkflowRuns)
                .where(eq(s.customerWorkflowRuns.workflowId, workflowId))
                .orderBy(desc(s.customerWorkflowRuns.createdAt));
        }
        async function finish(run, options = {}) {
            for (let i = 0; i < 30; i++) {
                await processWorkflowRun(run.id, { exec: db, now, ...options });
                const [row] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(eq(s.customerWorkflowRuns.id, run.id));
                if (
                    ["failed", "succeeded", "skipped", "cancelled"].includes(
                        row.state,
                    )
                )
                    return row;
            }
            throw new Error("run did not finish");
        }
        await event();
        const src = await source();
        let flow;
        await check(
            "마이그레이션 컬럼·native/API 계약·권한/사업 격리",
            async () => {
                const { getTableConfig } = require("drizzle-orm/pg-core");
                for (const table of [
                    s.customerWorkflows,
                    s.customerWorkflowRevisions,
                    s.customerWorkflowPreviews,
                    s.customerWorkflowRuns,
                    s.customerWorkflowSteps,
                    s.customerWorkflowAudit,
                ]) {
                    const config = getTableConfig(table),
                        columns = (
                            await pg.query(
                                "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                                [config.name],
                            )
                        ).rows;
                    assert.deepEqual(
                        columns.map((c) => c.column_name).sort(),
                        config.columns.map((c) => c.name).sort(),
                    );
                }
                flow = await create([
                    node("task", {
                        title: "가상 후속 업무",
                        body: "검토해주세요",
                        ownerId: actor.userId,
                        dueMinutes: 60,
                    }),
                ]);
                await assert.rejects(
                    () => request(clients.bo, "/" + flow.workflow.id),
                    (e) => [403, 404].includes(e.status),
                );
                await assert.rejects(
                    () => request(clients.read, "", "POST", { workspaceId: 8 }),
                    (e) => e.status === 403,
                );
            },
        );
        await check(
            "저장만으로 적용 안 함·같은 버전 모의 실행 필요·모의 실행 무변경",
            async () => {
                assert.equal(flow.workflow.enabled, false);
                const before = (await db.select().from(s.crmTasks)).length;
                await assert.rejects(
                    () =>
                        request(clients.dh, "/" + flow.workflow.id, "POST", {
                            action: "publish",
                            version: 1,
                            revisionId: flow.revision.id,
                            previewId: randomUUID(),
                            allowCustomerReplies: false,
                        }),
                    (e) => e.status === 400,
                );
                const report = await publish(flow, src);
                assert.ok(report.passed);
                assert.equal(report.report.steps[0].status, "planned");
                assert.equal(
                    (await db.select().from(s.crmTasks)).length,
                    before,
                );
                assert.equal((await runs(flow.workflow.id)).length, 0);
            },
        );
        let run;
        await check(
            "게시 이후 새 이벤트 등록·멱등 실행·원본 작업과 결과 원자성",
            async () => {
                const e = await event();
                [run] = await runs(flow.workflow.id);
                assert.ok(run);
                const saved = await finish(run);
                assert.equal(saved.state, "succeeded");
                await processWorkflowRun(run.id, { exec: db, now });
                const tasks = await db
                    .select()
                    .from(s.crmTasks)
                    .where(
                        eq(
                            s.crmTasks.externalId,
                            `workflow:${run.id}:${flow.revision.definition.steps[0].id}`,
                        ),
                    );
                assert.equal(tasks.length, 1);
                const orig = await source();
                await enqueuePlatformEvent(db, {
                    orgId: actor.orgId,
                    workspaceId: 8,
                    key: `event:${e.id}`,
                    type: "customer.event",
                    data: orig.payload.data,
                });
                assert.equal((await runs(flow.workflow.id)).length, 1);
            },
        );
        await check("자동화 파생 이벤트는 다시 자동화 시작 안 함", async () => {
            const generated = await db
                .select()
                .from(s.platformEvents)
                .where(eq(s.platformEvents.workflowRunId, run.id));
            assert.ok(generated.some((e) => e.type === "task.created"));
            assert.equal(
                (
                    await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(
                            eq(s.customerWorkflowRuns.eventId, generated[0].id),
                        )
                ).length,
                0,
            );
        });
        await check(
            "조건 분기·대기 후 최신 고객 값 재평가·단계별 한 번 기록",
            async () => {
                const wf = await create([
                    node("wait", { minutes: 30 }),
                    node("contact_stage", {
                        stage: "prospect",
                        when: {
                            mode: "all",
                            rules: [
                                {
                                    path: "contact.lifecycleStage",
                                    op: "eq",
                                    value: "lead",
                                },
                            ],
                        },
                    }),
                ]);
                await publish(wf, src);
                await event();
                const [queued] = await runs(wf.workflow.id);
                await processWorkflowRun(queued.id, {
                    exec: db,
                    now: () => new Date(),
                });
                let [waiting] = await runs(wf.workflow.id);
                assert.equal(waiting.state, "waiting");
                assert.equal(waiting.cursor, 1);
                await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: contacts.dh.externalId,
                    name: contacts.dh.name,
                    lifecycleStage: "customer",
                });
                assert.equal(
                    await processWorkflowRun(queued.id, {
                        exec: db,
                        now: () => new Date(),
                    }),
                    false,
                );
                const done = await finish(queued);
                assert.equal(done.state, "skipped");
                const [contact] = await db
                    .select()
                    .from(s.crmContacts)
                    .where(eq(s.crmContacts.id, contacts.dh.id));
                assert.equal(contact.lifecycleStage, "customer");
                const logs = await db
                    .select()
                    .from(s.customerWorkflowSteps)
                    .where(eq(s.customerWorkflowSteps.runId, queued.id));
                assert.equal(logs.length, 2);
                assert.equal(logs[1].state, "skipped");
            },
        );
        await check(
            "실행 중인 버전 게시·오래된 편집 충돌·게시 원본 보존",
            async () => {
                const wf = await create([
                    node("wait", { minutes: 30 }),
                    node("task", {
                        title: "취소될 업무",
                        body: "",
                        ownerId: null,
                        dueMinutes: 0,
                    }),
                ]);
                await publish(wf, src);
                await event();
                const [queued] = await runs(wf.workflow.id);
                await processWorkflowRun(queued.id, {
                    exec: db,
                    now: () => new Date(),
                });
                const current = await request(clients.dh, "/" + wf.workflow.id);
                await assert.rejects(
                    () =>
                        request(clients.dh, "/" + wf.workflow.id, "PATCH", {
                            workspaceId: 8,
                            version: 1,
                            name: "이전",
                            description: "",
                            definition: wf.revision.definition,
                        }),
                    (e) => e.status === 409,
                );
                const copied = await request(
                    clients.dh,
                    "/" + wf.workflow.id,
                    "PATCH",
                    {
                        workspaceId: 8,
                        version: current.workflow.version,
                        name: "새 버전",
                        description: "",
                        definition: {
                            ...wf.revision.definition,
                            steps: [
                                node("contact_stage", { stage: "prospect" }),
                            ],
                        },
                    },
                );
                await publish(copied, src);
                const [cancelled] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(eq(s.customerWorkflowRuns.id, queued.id));
                assert.equal(cancelled.state, "cancelled");
                assert.equal(
                    await processWorkflowRun(queued.id, { exec: db, now }),
                    false,
                );
                const old = await r.workflowRevision(
                    wf.workflow.id,
                    wf.revision.id,
                    db,
                );
                assert.equal(old.definition.steps[0].kind, "wait");
            },
        );
        await check(
            "자동화 중단·실행 단건 취소·이후 신규 등록 차단",
            async () => {
                const wf = await create([node("wait", { minutes: 60 })]);
                await publish(wf, src);
                await event();
                const [one] = await runs(wf.workflow.id);
                await request(
                    clients.dh,
                    `/${wf.workflow.id}/runs/${one.id}`,
                    "POST",
                    { action: "cancel" },
                );
                assert.equal((await finish(one)).state, "cancelled");
                const d = await request(clients.dh, "/" + wf.workflow.id);
                await request(clients.dh, "/" + wf.workflow.id, "POST", {
                    action: "disable",
                    version: d.workflow.version,
                });
                const count = (await runs(wf.workflow.id)).length;
                await event();
                assert.equal((await runs(wf.workflow.id)).length, count);
            },
        );
        await check(
            "일시 SQL 실패는 롤백·재시도, 실패한 단계부터 수동 복구",
            async () => {
                const wf = await create([
                    node("task", {
                        title: "복구 QA 업무",
                        body: "",
                        ownerId: null,
                        dueMinutes: 0,
                    }),
                    node("event", { name: "workflow.completed" }),
                ]);
                await publish(wf, src);
                await event();
                const [queued] = await runs(wf.workflow.id);
                const actual =
                    require("../src/lib/customer-workflows/actions.ts").executeWorkflowAction;
                let fail = true;
                const perform = async (...args) => {
                    const result = await actual(...args);
                    if (fail) {
                        fail = false;
                        throw Object.assign(
                            new Error("fake serialization failure"),
                            { code: "40001" },
                        );
                    }
                    return result;
                };
                await processWorkflowRun(queued.id, { exec: db, now, perform });
                let [retry] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(eq(s.customerWorkflowRuns.id, queued.id));
                assert.equal(retry.state, "retry");
                assert.equal(
                    (
                        await db
                            .select()
                            .from(s.crmTasks)
                            .where(
                                eq(
                                    s.crmTasks.externalId,
                                    `workflow:${queued.id}:${wf.revision.definition.steps[0].id}`,
                                ),
                            )
                    ).length,
                    0,
                );
                await processWorkflowRun(queued.id, {
                    exec: db,
                    now: () => new Date(now().getTime() + 10000),
                });
                await processWorkflowRun(queued.id, {
                    exec: db,
                    now: () => new Date(now().getTime() + 10000),
                    perform: async () => {
                        throw new Error("fake nonretryable");
                    },
                });
                [retry] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(eq(s.customerWorkflowRuns.id, queued.id));
                assert.equal(retry.state, "failed");
                assert.equal(retry.cursor, 1);
                await request(
                    clients.dh,
                    `/${wf.workflow.id}/runs/${queued.id}`,
                    "POST",
                    { action: "retry" },
                );
                assert.equal((await finish(queued)).state, "succeeded");
                const done = await db
                    .select()
                    .from(s.customerWorkflowSteps)
                    .where(eq(s.customerWorkflowSteps.runId, queued.id));
                assert.equal(done.length, 2);
            },
        );
        await check(
            "내부 고객·팀원 이메일은 등록되어도 행동에서 제외",
            async () => {
                const internal = await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "internal-workflow",
                    name: "가상 내부",
                    isInternal: true,
                });
                await event("workflow.qa", internal);
                const [queued] = await runs(flow.workflow.id);
                assert.equal((await finish(queued)).state, "skipped");
            },
        );
        await check(
            "상담 태그·배정·상태·사람 이관과 공개 안내 최신성",
            async () => {
                const wf = await create(
                    [
                        node("reply", {
                            body: "안녕하세요 {{conversation.name}}님, 가상 안내입니다.",
                        }),
                        node("tag", { tag: "관심", remove: false }),
                        node("assign", { assigneeId: actor.userId }),
                        node("task", {
                            title: "익명 후속 업무 QA",
                            body: "확인해주세요",
                            ownerId: null,
                            dueMinutes: 0,
                        }),
                        node("status", { status: "snoozed" }),
                        node("handoff"),
                    ],
                    ["message.created"],
                );
                const session = await repo.startVisitorSession(
                    channels.dh.publicKey,
                    { name: "가상 자동화 방문자" },
                    db,
                );
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    session.token,
                    { clientId: randomUUID(), body: "첫 가상 문의" },
                    db,
                );
                let [eventRow] = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.type, "message.created"),
                            eq(s.platformEvents.workspaceId, 8),
                        ),
                    )
                    .orderBy(desc(s.platformEvents.sequence))
                    .limit(1);
                await publish(wf, eventRow);
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    session.token,
                    { clientId: randomUUID(), body: "새 가상 문의" },
                    db,
                );
                const [queued] = await runs(wf.workflow.id);
                assert.equal(
                    (await finish(queued, { now: () => new Date() })).state,
                    "succeeded",
                );
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    session.token,
                    db,
                );
                assert.equal(
                    view.messages.filter((m) => m.authorName === "자동 안내")
                        .length,
                    1,
                );
                const detail = await repo.conversationDetail(
                    actor,
                    session.id,
                    db,
                );
                assert.ok(detail.conversation.tags.includes("관심"));
                assert.equal(detail.conversation.assigneeId, actor.userId);
                assert.equal(detail.conversation.aiState, "human");
                assert.equal(detail.conversation.status, "open");
                const [followup] = await db
                    .select()
                    .from(s.crmTasks)
                    .where(
                        eq(
                            s.crmTasks.externalId,
                            `workflow:${queued.id}:${wf.revision.definition.steps[3].id}`,
                        ),
                    );
                assert.ok(followup.body.includes(`conversation=${session.id}`));
            },
        );
        await check(
            "게시 사용자 권한 철회·참조 담당자/딜 단계 범위 검사",
            async () => {
                await assert.rejects(
                    () =>
                        create([
                            node("assign", {
                                assigneeId: ctx.otherActor.userId,
                            }),
                        ]),
                    (e) => e.status === 400,
                );
                const wf = await create([
                    node("task", {
                        title: "권한 QA",
                        body: "",
                        ownerId: null,
                        dueMinutes: 0,
                    }),
                ]);
                await publish(wf, src);
                await event();
                const [queued] = await runs(wf.workflow.id);
                await db
                    .update(s.organizationMembers)
                    .set({ role: "member" })
                    .where(
                        and(
                            eq(
                                s.organizationMembers.organizationId,
                                actor.orgId,
                            ),
                            eq(s.organizationMembers.userId, actor.userId),
                        ),
                    );
                assert.equal((await finish(queued)).state, "failed");
                await assert.rejects(
                    () =>
                        request(clients.dh, "/" + wf.workflow.id, "POST", {
                            action: "disable",
                            version: 2,
                        }),
                    (e) => e.status === 403,
                );
                await db
                    .update(s.organizationMembers)
                    .set({ role: "admin" })
                    .where(
                        and(
                            eq(
                                s.organizationMembers.organizationId,
                                actor.orgId,
                            ),
                            eq(s.organizationMembers.userId, actor.userId),
                        ),
                    );
            },
        );
        await check(
            "딜 단계·상담 상태·생성 업무의 상담 링크·개인화 변수 검사",
            async () => {
                const stages = [
                    { id: randomUUID(), name: "문의", category: "open" },
                    { id: randomUUID(), name: "계약", category: "won" },
                ];
                const pipeline = await clients.dh.request(
                    "/api/v1/crm/pipelines",
                    "POST",
                    {
                        workspaceId: 8,
                        externalId: "workflow-pipeline",
                        name: "가상 자동화 영업",
                        stages,
                    },
                );
                const def = [
                        node("deal_stage", {
                            pipelineId: pipeline.id,
                            stageId: stages[1].id,
                        }),
                    ],
                    wf = await create(def, ["deal.created"]);
                const dealInput = {
                    workspaceId: 8,
                    externalId: "preview-workflow-deal",
                    title: "미리보기 거래",
                    pipelineId: pipeline.id,
                    stageId: stages[0].id,
                    contactId: contacts.dh.id,
                    amount: "1000",
                    currency: "KRW",
                };
                await clients.dh.request(
                    "/api/v1/crm/deals",
                    "POST",
                    dealInput,
                );
                const [sample] = await db
                    .select()
                    .from(s.platformEvents)
                    .where(eq(s.platformEvents.type, "deal.created"))
                    .orderBy(desc(s.platformEvents.sequence))
                    .limit(1);
                await publish(wf, sample);
                const deal = await clients.dh.request(
                    "/api/v1/crm/deals",
                    "POST",
                    { ...dealInput, externalId: "new-workflow-deal" },
                );
                const [queued] = await runs(wf.workflow.id);
                assert.equal((await finish(queued)).state, "succeeded");
                const [changed] = await db
                    .select()
                    .from(s.crmDeals)
                    .where(eq(s.crmDeals.id, deal.id));
                assert.equal(changed.stageId, stages[1].id);
                await assert.rejects(
                    () =>
                        create([
                            node("task", {
                                title: "{{contact.unknown}}",
                                body: "",
                                ownerId: null,
                                dueMinutes: 0,
                            }),
                        ]),
                    (e) => e.status === 400,
                );
                const list = await clients.dh.workflows(8);
                assert.ok(list.rows.some((w) => w.id === wf.workflow.id));
                assert.ok(
                    (await clients.dh.workflowEvents(8)).rows.some(
                        (e) => e.customerName === contacts.dh.name,
                    ),
                );
            },
        );
        await check(
            "새 답변·오래된 문의·중단 경쟁과 lease 복구 한도",
            async () => {
                const wf = await create(
                    [node("reply", { body: "가상 자동 안내" })],
                    ["message.created"],
                );
                const session = await repo.startVisitorSession(
                    channels.dh.publicKey,
                    { name: "가상 경쟁 QA" },
                    db,
                );
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    session.token,
                    { clientId: randomUUID(), body: "미리보기 문의" },
                    db,
                );
                const [sample] = await db
                    .select()
                    .from(s.platformEvents)
                    .where(eq(s.platformEvents.type, "message.created"))
                    .orderBy(desc(s.platformEvents.sequence))
                    .limit(1);
                await publish(wf, sample);
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    session.token,
                    { clientId: randomUUID(), body: "경쟁 문의" },
                    db,
                );
                const [queued] = await runs(wf.workflow.id);
                await clients.dh.reply(
                    session.id,
                    "상담원이 안내했습니다.",
                    randomUUID(),
                );
                assert.equal(
                    (await finish(queued, { now: () => new Date() })).state,
                    "skipped",
                );
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    session.token,
                    db,
                );
                assert.equal(
                    view.messages.some((m) => m.authorName === "자동 안내"),
                    false,
                );
                const delayed = await create([
                    node("task", {
                        title: "복원 한도 QA",
                        body: "",
                        ownerId: null,
                        dueMinutes: 0,
                    }),
                ]);
                await publish(delayed, src);
                await event();
                const [crashed] = await runs(delayed.workflow.id);
                await db
                    .update(s.customerWorkflowRuns)
                    .set({
                        state: "running",
                        attempts: 5,
                        leaseId: randomUUID(),
                        leaseUntil: new Date("2000-01-01"),
                    })
                    .where(eq(s.customerWorkflowRuns.id, crashed.id));
                await processWorkflowRun(crashed.id, { exec: db, now });
                const [failed] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(eq(s.customerWorkflowRuns.id, crashed.id));
                assert.equal(failed.state, "failed");
                const race = await create([
                    node("task", {
                        title: "중복 워커 QA",
                        body: "",
                        ownerId: null,
                        dueMinutes: 0,
                    }),
                ]);
                await publish(race, src);
                await event();
                let [pending] = await runs(race.workflow.id);
                let release, entered;
                let ready = new Promise((resolve) => (entered = resolve)),
                    gate = new Promise((resolve) => (release = resolve));
                let first = processWorkflowRun(pending.id, {
                    exec: db,
                    now: () => new Date(),
                    beforeExecute: async () => {
                        entered();
                        await gate;
                    },
                });
                await ready;
                await clients.dh.changeWorkflowRun(
                    race.workflow.id,
                    pending.id,
                    "cancel",
                );
                release();
                await first;
                assert.equal((await finish(pending)).state, "cancelled");
                await event();
                [pending] = await runs(race.workflow.id);
                ready = new Promise((resolve) => (entered = resolve));
                gate = new Promise((resolve) => (release = resolve));
                first = processWorkflowRun(pending.id, {
                    exec: db,
                    now: () => new Date(),
                    beforeExecute: async () => {
                        entered();
                        await gate;
                    },
                });
                await ready;
                await processWorkflowRun(pending.id, {
                    exec: db,
                    now: () => new Date(Date.now() + 61000),
                });
                release();
                await first;
                await finish(pending);
                const generated = await db
                    .select()
                    .from(s.crmTasks)
                    .where(
                        eq(
                            s.crmTasks.externalId,
                            `workflow:${pending.id}:${race.revision.definition.steps[0].id}`,
                        ),
                    );
                assert.equal(generated.length, 1);
                const current = await clients.dh.workflow(delayed.workflow.id),
                    again = await clients.dh.previewWorkflow(
                        delayed.workflow.id,
                        delayed.revision.id,
                        src.id,
                    );
                await assert.rejects(
                    () =>
                        clients.dh.publishWorkflow(
                            delayed.workflow.id,
                            current.workflow.version,
                            delayed.revision.id,
                            again.id,
                        ),
                    (e) => e.status === 409,
                );
            },
        );
        await check(
            "원본 이벤트 등록 롤백·100건 초과 실행 커서·기록 범위",
            async () => {
                const before = (await runs(flow.workflow.id)).length;
                await assert.rejects(() =>
                    db.transaction(async (tx) => {
                        await enqueuePlatformEvent(tx, {
                            orgId: actor.orgId,
                            workspaceId: 8,
                            key: "workflow-rollback-event",
                            type: "customer.event",
                            data: {
                                event: {
                                    name: "workflow.qa",
                                    contactId: contacts.dh.id,
                                },
                            },
                        });
                        throw new Error("rollback");
                    }),
                );
                assert.equal((await runs(flow.workflow.id)).length, before);
                const [base] = await runs(flow.workflow.id);
                await assert.rejects(() =>
                    db.insert(s.customerWorkflowRuns).values({
                        ...base,
                        id: randomUUID(),
                        eventId: randomUUID(),
                        state: "cancelled",
                        createdAt: new Date("2000-01-01"),
                    }),
                );
                const records = [];
                for (let i = 0; i < 105; i++) {
                    const id = randomUUID();
                    await db.insert(s.platformEvents).values({
                        id,
                        orgId: actor.orgId,
                        workspaceId: 8,
                        eventKey: "cursor:" + id,
                        type: "customer.event",
                        payload: {
                            id,
                            type: "customer.event",
                            apiVersion: "2026-10-14",
                            workspaceId: 8,
                            occurredAt: new Date().toISOString(),
                            data: { event: { name: "cursor" } },
                        },
                    });
                    records.push({
                        ...base,
                        id: randomUUID(),
                        eventId: id,
                        state: "cancelled",
                        createdAt: new Date("2000-01-01"),
                    });
                }
                await db.insert(s.customerWorkflowRuns).values(records);
                let cursor,
                    ids = [];
                for (let i = 0; i < 10; i++) {
                    const page = await clients.dh.workflowRuns(
                        flow.workflow.id,
                        cursor,
                    );
                    ids.push(...page.rows.map((r) => r.id));
                    if (!page.hasMore) break;
                    cursor = page.rows.at(-1).id;
                }
                assert.equal(
                    new Set(ids).size,
                    (await runs(flow.workflow.id)).length,
                );
                await assert.rejects(
                    () => clients.bo.workflowRun(flow.workflow.id, base.id),
                    (e) => [403, 404].includes(e.status),
                );
            },
        );
        await check(
            "백오피스랩 독립 실행·native 인증·24시간 지난 안내 제외",
            async () => {
                const sampleEvent = await clients.bo.track(10, contacts.bo.id, {
                    eventId: randomUUID(),
                    name: "bo.flow.qa",
                });
                void sampleEvent;
                const [sample] = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.workspaceId, 10),
                            eq(s.platformEvents.type, "customer.event"),
                        ),
                    )
                    .orderBy(desc(s.platformEvents.sequence))
                    .limit(1);
                const wf = await clients.bo.saveWorkflow({
                        workspaceId: 10,
                        version: 0,
                        name: "백오랩 독립 QA",
                        description: "",
                        definition: {
                            trigger: {
                                types: ["customer.event"],
                                eventName: "bo.flow.qa",
                                when: emptyGroup,
                            },
                            steps: [
                                node("task", {
                                    title: "백오랩 독립 자동 업무",
                                    body: "",
                                    ownerId: null,
                                    dueMinutes: 0,
                                }),
                            ],
                        },
                    }),
                    preview = await clients.bo.previewWorkflow(
                        wf.workflow.id,
                        wf.revision.id,
                        sample.id,
                    );
                await clients.bo.publishWorkflow(
                    wf.workflow.id,
                    wf.workflow.version,
                    wf.revision.id,
                    preview.id,
                );
                await clients.bo.track(10, contacts.bo.id, {
                    eventId: randomUUID(),
                    name: "bo.flow.qa",
                });
                const [queued] = await runs(wf.workflow.id);
                assert.equal((await finish(queued)).state, "succeeded");
                const [task] = await db
                    .select()
                    .from(s.crmTasks)
                    .where(
                        eq(
                            s.crmTasks.externalId,
                            `workflow:${queued.id}:${wf.revision.definition.steps[0].id}`,
                        ),
                    );
                assert.equal(task.workspaceId, 10);
                assert.equal(task.contactId, contacts.bo.id);
                const { NextRequest } = require("next/server"),
                    { generateToken } = require("../src/lib/auth.ts"),
                    native = ctx.modules["customer-workflows"];
                let response = await native.GET(
                    new NextRequest(
                        "http://127.0.0.1:3120/api/customer-workflows?workspaceId=8",
                    ),
                );
                assert.equal(response.status, 401);
                response = await native.GET(
                    new NextRequest(
                        "http://127.0.0.1:3120/api/customer-workflows?workspaceId=8",
                        {
                            headers: {
                                authorization:
                                    "Bearer " +
                                    generateToken({
                                        ...actor,
                                        email: "staff@example.test",
                                    }),
                            },
                        },
                    ),
                );
                assert.equal(response.status, 200);
                const actions = require("../src/lib/customer-workflows/actions.ts"),
                    context = require("../src/lib/customer-workflows/context.ts");
                const old = {
                    type: "message.created",
                    occurredAt: "2000-01-01T00:00:00.000Z",
                    data: { message: { kind: "customer", id: 1 } },
                };
                const loaded = await context.workflowContext(
                    actor.orgId,
                    8,
                    old,
                    db,
                );
                assert.ok(
                    actions
                        .stepTargetProblem(
                            node("reply", { body: "늦은 안내" }),
                            {
                                ...loaded,
                                conversation: {
                                    enabled: true,
                                    status: "open",
                                    aiState: "auto",
                                    lastPublicId: 1,
                                },
                            },
                            new Date(),
                        )
                        .includes("24시간"),
                );
                const fresh = {
                    ...loaded,
                    event: { ...old, occurredAt: new Date().toISOString() },
                    conversation: {
                        enabled: true,
                        status: "open",
                        aiState: "auto",
                        lastPublicId: 1,
                    },
                };
                assert.equal(
                    actions.stepTargetProblem(
                        node("reply", { body: "가상 안내" }),
                        fresh,
                        new Date(),
                    ),
                    null,
                );
                assert.ok(
                    actions
                        .stepTargetProblem(
                            node("reply", { body: "가상 안내" }),
                            {
                                ...fresh,
                                event: {
                                    ...fresh.event,
                                    data: {
                                        message: {
                                            kind: "customer",
                                            id: 1,
                                            attachments: [{}],
                                        },
                                    },
                                },
                            },
                            new Date(),
                        )
                        .includes("첨부"),
                );
                for (const chat of [
                    { ...fresh.conversation, lastPublicId: 2 },
                    { ...fresh.conversation, aiState: "human" },
                    { ...fresh.conversation, status: "closed" },
                ])
                    assert.ok(
                        actions.stepTargetProblem(
                            node("reply", { body: "가상 안내" }),
                            { ...fresh, conversation: chat },
                            new Date(),
                        ),
                    );
            },
        );
        console.log(
            `고객 자동화 SQL/API QA: ${checks}개 통과. 실제 고객·모델·외부 발송 0건.`,
        );
        if (extra) await extra(ctx);
        else await pg.close();
    });
}
if (require.main === module)
    runWorkflowCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runWorkflowCheck };
