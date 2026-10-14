/* eslint-disable @typescript-eslint/no-require-imports -- 격리 PGlite·가상 CRM 자료만 사용하는 이력/보관 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto"),
    Module = require("node:module"),
    fs = require("node:fs");
async function runCustomerRecordsCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const {
                    db,
                    pg,
                    actor,
                    otherActor,
                    clients,
                    repo,
                    channels,
                    dispatch,
                } = ctx,
                s = require("../src/lib/db/schema.ts"),
                { eq, and, desc, inArray } = require("drizzle-orm"),
                previousLoad = Module._load;
            Module._load = function (name, parent) {
                const file = Module._resolveFilename(name, parent).replaceAll(
                    "\\",
                    "/",
                );
                return file.endsWith("/src/lib/db/index.ts")
                    ? { ...s, db, queryClient: ctx.queryClient }
                    : previousLoad.apply(this, arguments);
            };
            const records = require("../src/lib/customer-records/repository.ts"),
                core = require("../src/lib/customer-platform/repository.ts"),
                sales = require("../src/lib/customer-platform/sales-repository.ts"),
                flow = require("../src/lib/customer-workflows/repository.ts"),
                {
                    processWorkflowRun,
                } = require("../src/lib/customer-workflows/worker.ts"),
                files = require("../src/lib/inbox/files.ts"),
                email = require("../src/lib/inbox-email/repository.ts"),
                {
                    generateToken,
                    resolveApiToken,
                } = require("../src/lib/auth.ts"),
                {
                    changeAccess,
                } = require("../src/lib/customer-access/repository.ts");
            Module._load = previousLoad;
            for (const key of [ctx.keys.dh, ctx.keys.bo]) {
                const token = await resolveApiToken(key);
                const scopes = await db
                    .select()
                    .from(s.apiTokenScopes)
                    .where(eq(s.apiTokenScopes.tokenId, token.id));
                for (const scope of scopes)
                    await db
                        .update(s.apiTokenScopes)
                        .set({
                            permissions: { ...scope.permissions, delete: true },
                        })
                        .where(eq(s.apiTokenScopes.id, scope.id));
            }
            let checks = 0;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS RECORDS ${++checks} ${name}`);
            };
            const native = async (path, who = actor, method = "GET", body) => {
                const r = await dispatch("http://127.0.0.1:3120" + path, {
                    method,
                    headers: {
                        authorization: `Bearer ${generateToken(who)}`,
                        origin: "http://127.0.0.1:3120",
                        "content-type": "application/json",
                    },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                });
                return { status: r.status, ...(await r.json()) };
            };
            let co = await clients.dh.upsertCompany({
                    workspaceId: 8,
                    externalId: "records-company",
                    name: "가상 연결 회사",
                    domain: "company.example.test",
                    attributes: { tier: "A" },
                }),
                c = await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "records-contact",
                    name: "가상 기록 고객",
                    email: "record-customer@example.test",
                    companyIds: [co.id],
                    attributes: {
                        zero: 0,
                        flag: false,
                        empty: null,
                        remove: "old",
                        nested: { a: [1, false] },
                    },
                });
            const getC = async () => (await clients.dh.contact(8, c.id)).item;
            const pipeline = await sales.createSales(
                actor,
                "pipelines",
                {
                    workspaceId: 8,
                    externalId: "records-pipeline",
                    name: "기록 QA",
                    stages: [
                        { id: randomUUID(), name: "검토", category: "open" },
                    ],
                },
                db,
            );
            const deal = await sales.createSales(
                actor,
                "deals",
                {
                    workspaceId: 8,
                    externalId: "records-deal",
                    title: "가상 연결 딜",
                    pipelineId: pipeline.id,
                    stageId: pipeline.stages[0].id,
                    contactId: c.id,
                    companyId: co.id,
                    ownerId: actor.userId,
                    amount: "1000",
                    currency: "KRW",
                    notes: "보관 후에도 보존",
                },
                db,
            );
            let task = await sales.createSales(
                actor,
                "tasks",
                {
                    workspaceId: 8,
                    externalId: "records-task",
                    title: "가상 후속 업무",
                    contactId: c.id,
                    companyId: co.id,
                    dealId: deal.id,
                    ownerId: actor.userId,
                    body: "보관 후에도 보존",
                    status: "open",
                },
                db,
            );
            const identity = await clients.dh.customerIdentity(
                    channels.dh.id,
                    c.id,
                ),
                session = await repo.startVisitorSession(
                    channels.dh.publicKey,
                    { identityToken: identity.identityToken },
                    db,
                );
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                session.token,
                { body: "이력 QA 문의", clientId: randomUUID() },
                db,
            );
            const attachment = await files.uploadAttachment(
                await repo.staffFileScope(actor, session.id, db),
                {
                    clientId: randomUUID(),
                    kind: "note",
                    fileName: "records.pdf",
                    bytes: Buffer.from("%PDF-1.4\nCRM QA"),
                },
                db,
            );
            await repo.sendAgentMessage(
                actor,
                session.id,
                {
                    kind: "note",
                    body: "가상 보존 자료",
                    attachmentIds: [attachment.id],
                    clientId: randomUUID(),
                },
                db,
            );
            const attachmentHash = (
                await db
                    .select()
                    .from(s.inboxAttachments)
                    .where(eq(s.inboxAttachments.id, attachment.id))
            )[0].sha256;
            const auditRows = async (id = c.id, resource = "contacts") =>
                db
                    .select()
                    .from(s.crmObjectAudit)
                    .where(
                        and(
                            eq(s.crmObjectAudit.objectId, id),
                            eq(s.crmObjectAudit.resource, resource),
                        ),
                    )
                    .orderBy(desc(s.crmObjectAudit.version));
            const group = { mode: "all", rules: [] },
                track = () =>
                    clients.dh.track(8, c.id, {
                        eventId: randomUUID(),
                        name: "records.qa",
                        properties: {},
                    });
            let published;
            async function queued() {
                await track();
                return (
                    await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(
                            eq(
                                s.customerWorkflowRuns.workflowId,
                                published.workflow.id,
                            ),
                        )
                        .orderBy(desc(s.customerWorkflowRuns.createdAt))
                )[0];
            }
            async function finish(id) {
                for (let i = 0; i < 8; i++) {
                    await processWorkflowRun(id, {
                        exec: db,
                        now: () => new Date(Date.now() + (i + 1) * 120 * 60000),
                    });
                    const [run] = await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(eq(s.customerWorkflowRuns.id, id));
                    if (
                        [
                            "succeeded",
                            "failed",
                            "cancelled",
                            "skipped",
                        ].includes(run.state)
                    )
                        return run;
                }
                throw new Error("QA run did not finish");
            }
            const employee = {
                ...actor,
                userId: randomUUID(),
                name: "가상 CRM 담당",
                role: "member",
            };
            await db.insert(s.users).values({
                id: employee.userId,
                orgId: actor.orgId,
                name: employee.name,
                email: "records-agent@example.test",
                password: "fake-only",
            });
            await db.insert(s.organizationMembers).values({
                organizationId: actor.orgId,
                userId: employee.userId,
                role: "member",
            });
            await changeAccess(
                actor,
                8,
                { userId: employee.userId, role: "agent", version: 0 },
                db,
            );
            await check(
                "실제 SQL 컬럼·API와 SDK의 고객/회사 버전·API 작성자 감사",
                async () => {
                    const { getTableConfig } = require("drizzle-orm/pg-core");
                    for (const table of [
                        s.crmContacts,
                        s.crmCompanies,
                        s.crmObjectAudit,
                        s.customerWorkflowRuns,
                    ]) {
                        const config = getTableConfig(table),
                            columns = (
                                await pg.query(
                                    "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                                    [config.name],
                                )
                            ).rows;
                        assert.deepEqual(
                            columns.map((x) => x.column_name).sort(),
                            config.columns.map((x) => x.name).sort(),
                        );
                    }
                    assert.equal(c.version, 1);
                    assert.equal(c.archivedAt, null);
                    assert.equal(co.version, 1);
                    const detail = await clients.dh.contact(8, c.id);
                    assert.equal(detail.creationTracked, true);
                    assert.equal(detail.history[0].source, "api");
                    assert.equal(detail.history[0].actorId, actor.userId);
                    assert.equal(
                        detail.history[0].changes.companyIds.afterLabel,
                        "가상 연결 회사",
                    );
                    assert.equal(detail.impact.deals, 1);
                    assert.equal(detail.impact.tasks, 1);
                    assert.equal(detail.impact.conversations, 1);
                },
            );
            await check(
                "동일 값·관계 순서·명시적 undefined는 버전/감사/이벤트를 추가하지 않음",
                async () => {
                    const before = (await auditRows()).length,
                        events = (await db.select().from(s.platformEvents))
                            .length;
                    const next = await core.upsertContact(
                        actor.orgId,
                        {
                            workspaceId: 8,
                            externalId: c.externalId,
                            name: c.name,
                            email: undefined,
                            companyIds: [co.id],
                            attributes: { nested: { a: [1, false] }, zero: 0 },
                        },
                        true,
                        db,
                        { actor, source: "api" },
                    );
                    assert.equal(next.version, c.version);
                    assert.equal(next.email, c.email);
                    assert.equal((await auditRows()).length, before);
                    assert.equal(
                        (await db.select().from(s.platformEvents)).length,
                        events,
                    );
                },
            );
            await check(
                "버전 지정 필드 수정·속성 전체 교체와 삭제/빈 값의 구분",
                async () => {
                    c = await clients.dh.updateContact(c.id, {
                        workspaceId: 8,
                        version: c.version,
                        name: "가상 기록 고객 수정",
                        attributes: {
                            zero: 0,
                            flag: false,
                            empty: null,
                            added: null,
                        },
                    });
                    const history = (await auditRows())[0];
                    assert.equal(history.version, 2);
                    assert.equal(history.changes.name.before, "가상 기록 고객");
                    assert.equal(
                        history.changes['attributes["remove"]'].afterPresent,
                        false,
                    );
                    assert.equal(
                        history.changes['attributes["added"]'].afterPresent,
                        true,
                    );
                    assert.equal(
                        history.changes['attributes["added"]'].after,
                        null,
                    );
                    assert.equal(
                        history.changes['attributes["flag"]'],
                        undefined,
                    );
                    assert.deepEqual(c.companyIds, [co.id]);
                    assert.equal(
                        (await repo.conversationDetail(actor, session.id, db))
                            .conversation.name,
                        c.name,
                    );
                },
            );
            await check(
                "오래된 편집 CAS·불변 외부 ID·감사 작성자 위조 차단과 원자성",
                async () => {
                    const before = (await auditRows()).length;
                    await assert.rejects(
                        clients.dh.updateContact(c.id, {
                            workspaceId: 8,
                            version: 1,
                            name: "덮어쓰기",
                        }),
                        (e) => e.status === 409,
                    );
                    for (const extra of [
                        { externalId: "changed" },
                        { source: "staff" },
                        { actorName: "위조" },
                    ])
                        assert.equal(
                            (
                                await native(
                                    `/api/customer-crm/contacts/${c.id}`,
                                    actor,
                                    "PATCH",
                                    {
                                        workspaceId: 8,
                                        version: c.version,
                                        ...extra,
                                    },
                                )
                            ).status,
                            400,
                        );
                    assert.equal((await getC()).version, c.version);
                    assert.equal((await auditRows()).length, before);
                },
            );
            await check(
                "직원 편집 출처·회사 이름 변경 전 관계 라벨·공통 고객 활동",
                async () => {
                    const changed = await native(
                        `/api/customer-crm/contacts/${c.id}`,
                        employee,
                        "PATCH",
                        {
                            workspaceId: 8,
                            version: c.version,
                            phone: "010-0000-0000",
                        },
                    );
                    assert.equal(changed.status, 200);
                    c = changed.data;
                    assert.equal((await auditRows())[0].source, "staff");
                    assert.equal(
                        (await auditRows())[0].actorId,
                        employee.userId,
                    );
                    co = await clients.dh.updateCompany(co.id, {
                        workspaceId: 8,
                        version: co.version,
                        name: "이름 변경 회사",
                        attributes: { tier: "S" },
                    });
                    assert.equal(
                        (await clients.dh.contact(8, c.id)).history.find(
                            (h) => h.action === "created",
                        ).changes.companyIds.afterLabel,
                        "가상 연결 회사",
                    );
                    assert.ok(
                        (await clients.dh.customerActivities(8, c.id)).some(
                            (a) => a.source === "profile" && a.metadata.auditId,
                        ),
                    );
                },
            );
            await check(
                "보관/수정/이력의 사업·조직·역할·API delete 범위",
                async () => {
                    await assert.rejects(
                        clients.bo.contact(8, c.id),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        records.customerObjectDetail(
                            otherActor,
                            9,
                            "contacts",
                            c.id,
                            undefined,
                            db,
                        ),
                        (e) => e.status === 404,
                    );
                    assert.equal(
                        (
                            await native(
                                `/api/customer-crm/contacts/${c.id}`,
                                employee,
                                "POST",
                                {
                                    workspaceId: 8,
                                    version: c.version,
                                    action: "archive",
                                },
                            )
                        ).status,
                        403,
                    );
                    await assert.rejects(
                        clients.read.archiveContact(8, c.id, c.version),
                        (e) => e.status === 403,
                    );
                    const token = await resolveApiToken(ctx.keys.dh),
                        scopes = await db
                            .select()
                            .from(s.apiTokenScopes)
                            .where(eq(s.apiTokenScopes.tokenId, token.id));
                    for (const scope of scopes)
                        await db
                            .update(s.apiTokenScopes)
                            .set({
                                permissions: {
                                    ...scope.permissions,
                                    delete: false,
                                },
                            })
                            .where(eq(s.apiTokenScopes.id, scope.id));
                    await assert.rejects(
                        clients.dh.archiveContact(8, c.id, c.version),
                        (e) => e.status === 403,
                    );
                    for (const scope of scopes)
                        await db
                            .update(s.apiTokenScopes)
                            .set({ permissions: scope.permissions })
                            .where(eq(s.apiTokenScopes.id, scope.id));
                },
            );
            await check(
                "기존 자료는 도입 이전 필드 이력을 만들지 않음·merged 속성 크기 제한",
                async () => {
                    const [old] = await db
                        .insert(s.crmContacts)
                        .values({
                            orgId: actor.orgId,
                            workspaceId: 8,
                            externalId: "old-records",
                            name: "기존 가상 고객",
                            createdAt: new Date("2019-01-01"),
                        })
                        .returning();
                    const detail = await clients.dh.contact(8, old.id);
                    assert.equal(detail.creationTracked, false);
                    assert.equal(detail.history.length, 0);
                    const before = await getC();
                    await clients.dh.upsertContact({
                        workspaceId: 8,
                        externalId: "large-attrs",
                        name: "속성 크기 QA",
                        attributes: { one: "x".repeat(7000) },
                    });
                    await assert.rejects(
                        clients.dh.upsertContact({
                            workspaceId: 8,
                            externalId: "large-attrs",
                            name: "속성 크기 QA",
                            attributes: { two: "y".repeat(7000) },
                        }),
                        (e) => e.status === 400,
                    );
                    assert.equal((await getC()).version, before.version);
                },
            );
            await check(
                "자동화 실행 등록은 고객/회사 대상을 고정해 보관 시 찾을 수 있음",
                async () => {
                    published = await flow.saveWorkflow(
                        actor,
                        undefined,
                        {
                            workspaceId: 8,
                            version: 0,
                            name: "보관 QA 자동화",
                            description: "가상 고객",
                            definition: {
                                trigger: {
                                    types: ["customer.event"],
                                    eventName: "records.qa",
                                    when: group,
                                },
                                steps: [
                                    {
                                        id: randomUUID(),
                                        label: "관찰 대기",
                                        kind: "wait",
                                        minutes: 60,
                                        when: group,
                                    },
                                    {
                                        id: randomUUID(),
                                        label: "단계 변경",
                                        kind: "contact_stage",
                                        stage: "prospect",
                                        when: group,
                                    },
                                ],
                            },
                        },
                        db,
                    );
                    await track();
                    const [source] = await db
                        .select()
                        .from(s.platformEvents)
                        .where(
                            and(
                                eq(s.platformEvents.workspaceId, 8),
                                eq(s.platformEvents.type, "customer.event"),
                            ),
                        )
                        .orderBy(desc(s.platformEvents.sequence));
                    const preview = await flow.simulateWorkflow(
                        actor,
                        published.workflow.id,
                        published.revision.id,
                        source.id,
                        db,
                    );
                    assert.equal(preview.passed, true);
                    await flow.publishWorkflow(
                        actor,
                        published.workflow.id,
                        {
                            version: 1,
                            revisionId: published.revision.id,
                            previewId: preview.id,
                            allowCustomerReplies: false,
                        },
                        db,
                    );
                    const job = await queued();
                    assert.equal(job.subjectContactId, c.id);
                    assert.equal(job.subjectCompanyId, co.id);
                    await db
                        .update(s.customerWorkflowRuns)
                        .set({ state: "cancelled" })
                        .where(eq(s.customerWorkflowRuns.id, job.id));
                },
            );
            let stopped = [];
            await check(
                "보관 영향 미리보기·모든 미완료 상태 중단·관계/상담/첨부 보존",
                async () => {
                    for (const state of [
                        "queued",
                        "waiting",
                        "retry",
                        "running",
                    ]) {
                        const job = await queued();
                        await db
                            .update(s.customerWorkflowRuns)
                            .set({
                                state,
                                leaseId:
                                    state === "running" ? randomUUID() : null,
                                leaseUntil:
                                    state === "running"
                                        ? new Date(Date.now() + 60000)
                                        : null,
                                eligibleAt: new Date(Date.now() + 86400000),
                            })
                            .where(eq(s.customerWorkflowRuns.id, job.id));
                        stopped.push(job.id);
                    }
                    const detail = await clients.dh.contact(8, c.id);
                    assert.equal(detail.impact.pendingWorkflows, 4);
                    const result = await clients.dh.archiveContact(
                        8,
                        c.id,
                        c.version,
                        "가상 보관 QA",
                    );
                    c = result.item;
                    assert.equal(result.cancelledWorkflows, 4);
                    assert.ok(c.archivedAt);
                    const jobs = await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(inArray(s.customerWorkflowRuns.id, stopped));
                    assert.ok(
                        jobs.every(
                            (j) => j.state === "cancelled" && !j.leaseId,
                        ),
                    );
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.crmContactCompanies)
                                .where(
                                    eq(s.crmContactCompanies.contactId, c.id),
                                )
                        ).length,
                        1,
                    );
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.crmDeals)
                                .where(eq(s.crmDeals.id, deal.id))
                        )[0].contactId,
                        c.id,
                    );
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.crmTasks)
                                .where(eq(s.crmTasks.id, task.id))
                        )[0].status,
                        "open",
                    );
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.inboxAttachments)
                                .where(eq(s.inboxAttachments.id, attachment.id))
                        )[0].sha256,
                        attachmentHash,
                    );
                    assert.equal((await auditRows())[0].reason, "가상 보관 QA");
                    assert.equal((await auditRows())[0].action, "archived");
                },
            );
            await check(
                "보관함 검색/조회·기본 목록 제외·새 이벤트 자동화 차단·회원 문의 지속",
                async () => {
                    assert.ok(
                        !(await clients.dh.listContacts(8)).some(
                            (x) => x.id === c.id,
                        ),
                    );
                    assert.ok(
                        (
                            await clients.dh.listContacts(8, {
                                archived: "true",
                                q: "기록 고객",
                            })
                        ).some((x) => x.id === c.id),
                    );
                    assert.equal(
                        (
                            await native(
                                `/api/customer-crm/contacts?workspaceId=8&archived=all&q=${encodeURIComponent("기록 고객")}`,
                            )
                        ).data[0].id,
                        c.id,
                    );
                    const count = (
                        await db.select().from(s.customerWorkflowRuns)
                    ).length;
                    await track();
                    assert.equal(
                        (await db.select().from(s.customerWorkflowRuns)).length,
                        count,
                    );
                    await repo.sendVisitorMessage(
                        channels.dh.publicKey,
                        session.token,
                        {
                            body: "보관 이후에도 고객 문의",
                            clientId: randomUUID(),
                        },
                        db,
                    );
                    assert.ok(
                        (
                            await repo.conversationDetail(actor, session.id, db)
                        ).messages.some(
                            (m) => m.body === "보관 이후에도 고객 문의",
                        ),
                    );
                    await assert.rejects(
                        clients.dh.updateContact(c.id, {
                            workspaceId: 8,
                            version: c.version,
                            name: "보관 중 수동 수정",
                        }),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "연동 upsert는 보관을 유지·현재 버전 감사·복구는 예전 작업을 재개하지 않음",
                async () => {
                    const archivedAt = c.archivedAt;
                    c = await clients.dh.upsertContact({
                        workspaceId: 8,
                        externalId: c.externalId,
                        name: c.name,
                        attributes: { sync: "fresh" },
                    });
                    assert.equal(c.archivedAt, archivedAt);
                    const version = c.version;
                    c = (
                        await clients.dh.restoreContact(
                            8,
                            c.id,
                            version,
                            "가상 복구 QA",
                        )
                    ).item;
                    assert.equal(c.archivedAt, null);
                    assert.ok(
                        (await clients.dh.listContacts(8)).some(
                            (x) => x.id === c.id,
                        ),
                    );
                    for (const id of stopped)
                        assert.equal((await finish(id)).state, "cancelled");
                    const job = await queued();
                    const run = await finish(job.id);
                    assert.equal(run.state, "succeeded");
                    c = await getC();
                    assert.equal(c.lifecycleStage, "prospect");
                    assert.equal((await auditRows())[0].source, "workflow");
                },
            );
            await check(
                "보관과 복구의 현재 상태 재요청은 무변경·과거 버전 재요청은 409",
                async () => {
                    const before = (await auditRows()).length;
                    const same = await clients.dh.restoreContact(
                        8,
                        c.id,
                        c.version,
                    );
                    assert.equal(same.item.version, c.version);
                    assert.equal((await auditRows()).length, before);
                    const old = c.version;
                    c = (await clients.dh.archiveContact(8, c.id, old)).item;
                    await assert.rejects(
                        clients.dh.archiveContact(8, c.id, old),
                        (e) => e.status === 409,
                    );
                    const again = await clients.dh.archiveContact(
                        8,
                        c.id,
                        c.version,
                    );
                    assert.equal(again.item.version, c.version);
                    assert.equal(again.cancelledWorkflows, 0);
                    c = (await clients.dh.restoreContact(8, c.id, c.version))
                        .item;
                },
            );
            await check(
                "작업 claim 후 보관 경쟁에서도 이미 회수된 lease로 행동하지 않음",
                async () => {
                    const job = await queued();
                    let performed = 0;
                    await processWorkflowRun(job.id, {
                        exec: db,
                        now: () => new Date(),
                        beforeExecute: async () => {
                            const current = await getC();
                            c = (
                                await clients.dh.archiveContact(
                                    8,
                                    c.id,
                                    current.version,
                                )
                            ).item;
                        },
                        perform: async () => {
                            performed++;
                            return {};
                        },
                    });
                    assert.equal(performed, 0);
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.customerWorkflowRuns)
                                .where(eq(s.customerWorkflowRuns.id, job.id))
                        )[0].state,
                        "cancelled",
                    );
                    c = (await clients.dh.restoreContact(8, c.id, c.version))
                        .item;
                },
            );
            await check(
                "회사 보관도 대기 작업 중단·기존 관계 편집 유지·새 관계 거절",
                async () => {
                    const job = await queued();
                    const result = await clients.dh.archiveCompany(
                        8,
                        co.id,
                        co.version,
                    );
                    co = result.item;
                    assert.equal(result.cancelledWorkflows, 1);
                    assert.equal((await finish(job.id)).state, "cancelled");
                    assert.ok((await getC()).companyIds.includes(co.id));
                    c = await clients.dh.updateContact(c.id, {
                        workspaceId: 8,
                        version: c.version,
                        companyIds: [co.id],
                        phone: "010-0000-0001",
                    });
                    await assert.rejects(
                        clients.dh.upsertContact({
                            workspaceId: 8,
                            externalId: "forbidden-archived-company",
                            name: "신규 연결",
                            companyIds: [co.id],
                        }),
                        (e) => e.status === 409,
                    );
                    await assert.rejects(
                        sales.createSales(
                            actor,
                            "tasks",
                            {
                                workspaceId: 8,
                                externalId: "forbidden-task",
                                title: "새 연결 금지",
                                body: "",
                                companyId: co.id,
                                status: "open",
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    task = await sales.patchSales(
                        actor,
                        8,
                        "tasks",
                        task.id,
                        { version: task.version, title: "기존 관계는 보존" },
                        db,
                    );
                    assert.equal(task.companyId, co.id);
                    co = (await clients.dh.restoreCompany(8, co.id, co.version))
                        .item;
                    assert.equal(co.archivedAt, null);
                },
            );
            await check(
                "원본 수정·감사·활동·이벤트와 보관/작업 중단은 함께 롤백",
                async () => {
                    const before = await getC(),
                        audits = (await auditRows()).length,
                        events = (await db.select().from(s.platformEvents))
                            .length;
                    await assert.rejects(
                        core.upsertContact(
                            actor.orgId,
                            {
                                workspaceId: 8,
                                externalId: c.externalId,
                                name: "롤백 QA",
                            },
                            true,
                            db,
                            { actor, source: "invalid" },
                        ),
                    );
                    assert.equal((await getC()).name, before.name);
                    assert.equal((await auditRows()).length, audits);
                    const job = await queued(),
                        eventBaseline = (
                            await db.select().from(s.platformEvents)
                        ).length,
                        activityBaseline = (
                            await db.select().from(s.crmActivities)
                        ).length;
                    await assert.rejects(
                        db.transaction(async (tx) => {
                            await records.archiveCustomerObject(
                                actor,
                                8,
                                "contacts",
                                c.id,
                                { version: before.version, action: "archive" },
                                tx,
                            );
                            throw new Error("QA rollback");
                        }),
                    );
                    assert.equal((await getC()).version, before.version);
                    assert.equal((await getC()).archivedAt, null);
                    assert.equal(
                        (
                            await db
                                .select()
                                .from(s.customerWorkflowRuns)
                                .where(eq(s.customerWorkflowRuns.id, job.id))
                        )[0].state,
                        "queued",
                    );
                    assert.equal(
                        (await db.select().from(s.platformEvents)).length,
                        eventBaseline,
                    );
                    assert.equal(
                        (await db.select().from(s.crmActivities)).length,
                        activityBaseline,
                    );
                    assert.ok(events < eventBaseline);
                    await db
                        .update(s.customerWorkflowRuns)
                        .set({ state: "cancelled" })
                        .where(eq(s.customerWorkflowRuns.id, job.id));
                },
            );
            await check(
                "이메일 신규 고객의 출처·보관 고객의 새 스레드는 같은 고객 ID 유지",
                async () => {
                    let box = await email.createMailbox(
                        actor,
                        {
                            workspaceId: 8,
                            name: "이력 QA 메일함",
                            address: "records@example.test",
                        },
                        db,
                    );
                    box = await email.changeMailbox(
                        actor,
                        box.id,
                        { version: box.version, enabled: true },
                        db,
                    );
                    const receive = (id, thread) =>
                        email.receiveEmail(
                            actor,
                            box.id,
                            {
                                providerMessageId: id,
                                providerThreadId: thread,
                                rfcMessageId: `<${id}@example.test>`,
                                from: "mail-customer@example.test",
                                to: [box.address],
                                subject: "가상 이력 메일",
                                body: "가상 문의",
                                receivedAt: new Date().toISOString(),
                                files: [],
                            },
                            db,
                        );
                    const first = await receive(
                            "records-in-1",
                            "records-thread-1",
                        ),
                        [chat] = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(
                                eq(
                                    s.inboxConversations.id,
                                    first.conversationId,
                                ),
                            ),
                        detail = await clients.dh.contact(8, chat.contactId);
                    assert.equal(detail.history[0].source, "email");
                    const archived = (
                        await clients.dh.archiveContact(
                            8,
                            chat.contactId,
                            detail.item.version,
                        )
                    ).item;
                    const second = await receive(
                            "records-in-2",
                            "records-thread-2",
                        ),
                        [nextChat] = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(
                                eq(
                                    s.inboxConversations.id,
                                    second.conversationId,
                                ),
                            );
                    assert.equal(nextChat.contactId, chat.contactId);
                    assert.equal(
                        (await clients.dh.contact(8, chat.contactId)).item
                            .archivedAt,
                        archived.archivedAt,
                    );
                },
            );
            await check(
                "기존 자동화 대상 백필은 여러 출처·잘못된 ID·타 사업을 구분",
                async () => {
                    const [sourceEvent] = await db
                        .select()
                        .from(s.platformEvents)
                        .where(eq(s.platformEvents.workspaceId, 8))
                        .orderBy(desc(s.platformEvents.sequence));
                    const snapshots = [
                        { contactId: c.id },
                        { contactId: "bad", contact: { id: c.id } },
                        { event: { contactId: c.id } },
                        { deal: { id: deal.id } },
                        { taskId: task.id },
                        { conversationId: session.id },
                        { company: { id: co.id } },
                        { contactId: "not-a-uuid" },
                        { contactId: ctx.contacts.bo.id },
                    ];
                    const ids = [];
                    for (const data of snapshots) {
                        const eid = randomUUID();
                        await db.insert(s.platformEvents).values({
                            id: eid,
                            orgId: actor.orgId,
                            workspaceId: 8,
                            eventKey: `qa-migrate:${eid}`,
                            type: "customer.event",
                            payload: {
                                ...sourceEvent.payload,
                                id: eid,
                                data,
                            },
                        });
                        const [run] = await db
                            .insert(s.customerWorkflowRuns)
                            .values({
                                orgId: actor.orgId,
                                workspaceId: 8,
                                workflowId: published.workflow.id,
                                revisionId: published.revision.id,
                                generation: 1,
                                eventId: eid,
                                eventSnapshot: { data },
                                state: "cancelled",
                            })
                            .returning();
                        ids.push(run.id);
                    }
                    const sql = fs.readFileSync(
                        "drizzle/0103_crm_object_lifecycle.sql",
                        "utf8",
                    );
                    await pg.exec(sql.slice(sql.indexOf("WITH ids AS")));
                    const rows = await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(inArray(s.customerWorkflowRuns.id, ids));
                    for (let i = 0; i < 6; i++) {
                        const row = rows.find((r) => r.id === ids[i]);
                        assert.equal(row.subjectContactId, c.id);
                        assert.equal(row.subjectCompanyId, co.id);
                    }
                    assert.equal(
                        rows.find((r) => r.id === ids[6]).subjectCompanyId,
                        co.id,
                    );
                    assert.equal(
                        rows.find((r) => r.id === ids[7]).subjectContactId,
                        null,
                    );
                    assert.equal(
                        rows.find((r) => r.id === ids[8]).subjectContactId,
                        null,
                    );
                },
            );
            await check(
                "같은 시각 50건 감사 커서·다른 자료/사업 커서 차단",
                async () => {
                    const id = randomUUID();
                    await db.insert(s.crmContacts).values({
                        id,
                        orgId: actor.orgId,
                        workspaceId: 8,
                        externalId: "audit-page",
                        name: "이력 페이지 QA",
                    });
                    await db.insert(s.crmObjectAudit).values(
                        Array.from({ length: 51 }, (_, i) => ({
                            orgId: actor.orgId,
                            workspaceId: 8,
                            resource: "contacts",
                            objectId: id,
                            version: i + 1,
                            action: "updated",
                            actorName: actor.name,
                            source: "system",
                            changes: {},
                            createdAt: new Date("2026-01-01"),
                        })),
                    );
                    const first = await clients.dh.contact(8, id);
                    assert.equal(first.history.length, 50);
                    assert.equal(first.hasMore, true);
                    const next = await clients.dh.contact(
                        8,
                        id,
                        first.history.at(-1).id,
                    );
                    assert.equal(next.history.length, 1);
                    assert.ok(
                        !first.history.some((x) => x.id === next.history[0].id),
                    );
                    await assert.rejects(
                        clients.dh.contact(8, c.id, first.history[0].id),
                        (e) => e.status === 404,
                    );
                    const [b] = await db
                        .insert(s.crmContacts)
                        .values({
                            orgId: actor.orgId,
                            workspaceId: 10,
                            externalId: "bo-history",
                            name: "백오피스 이력 QA",
                        })
                        .returning();
                    await assert.rejects(
                        clients.bo.contact(10, b.id, first.history[0].id),
                        (e) => e.status === 404,
                    );
                },
            );
            await check(
                "보관 목록 100건 커서·백오피스 독립 보관/복구·일반 필터 유지",
                async () => {
                    await db.insert(s.crmCompanies).values(
                        Array.from({ length: 101 }, (_, i) => ({
                            orgId: actor.orgId,
                            workspaceId: 10,
                            externalId: `bo-archive-${i}`,
                            name: `백오피스 보관 ${i}`,
                            archivedAt: new Date(),
                        })),
                    );
                    const first = await clients.bo.listCompanies(10, {
                        archived: "true",
                        q: "백오피스 보관",
                    });
                    assert.equal(first.length, 100);
                    const next = await clients.bo.listCompanies(10, {
                        archived: "true",
                        q: "백오피스 보관",
                        before: first.at(-1).id,
                    });
                    assert.equal(next.length, 1);
                    assert.ok(!first.some((x) => x.id === next[0].id));
                    const company = await clients.bo.upsertCompany({
                        workspaceId: 10,
                        externalId: "bo-lifecycle",
                        name: "백오피스 독립 회사",
                    });
                    const archived = (
                        await clients.bo.archiveCompany(
                            10,
                            company.id,
                            company.version,
                        )
                    ).item;
                    assert.ok(archived.archivedAt);
                    assert.ok(
                        !(await clients.bo.listCompanies(10)).some(
                            (x) => x.id === company.id,
                        ),
                    );
                    assert.equal(
                        (
                            await clients.bo.restoreCompany(
                                10,
                                company.id,
                                archived.version,
                            )
                        ).item.archivedAt,
                        null,
                    );
                },
            );
            console.log(
                `고객·회사 이력/보관 SQL/API QA ${checks}개 통과 · 가상 자료만 사용 · 실제 외부 전송/운영 DB 접근 0건`,
            );
            if (extra) await extra({ ...ctx, customerRecordsChecks: checks });
            else await pg.close();
        },
    );
}
if (require.main === module)
    runCustomerRecordsCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runCustomerRecordsCheck };
