/* eslint-disable @typescript-eslint/no-require-imports -- PGlite·가상 직원·고객 전용 권한 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto"),
    Module = require("node:module");
async function runAccessCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const {
                db,
                pg,
                actor,
                channels,
                repo,
                clients,
                contacts,
                dispatch,
            } = ctx;
            const s = require("../src/lib/db/schema.ts"),
                { eq, and, desc } = require("drizzle-orm"),
                previousLoad = Module._load;
            Module._load = function (name, parent) {
                const file = Module._resolveFilename(name, parent).replaceAll(
                    "\\",
                    "/",
                );
                return file.endsWith("/src/lib/db/index.ts")
                    ? { ...s, db }
                    : previousLoad.apply(this, arguments);
            };
            const {
                    generateToken,
                    resolveApiToken,
                } = require("../src/lib/auth.ts"),
                access = require("../src/lib/customer-access/repository.ts"),
                {
                    requireCustomerAccess,
                } = require("../src/lib/customer-access/access.ts"),
                files = require("../src/lib/inbox/files.ts"),
                email = require("../src/lib/inbox-email/repository.ts"),
                oauth = require("../src/lib/inbox-email/google-connection.ts"),
                workflows = require("../src/lib/customer-workflows/repository.ts"),
                {
                    processWorkflowRun,
                } = require("../src/lib/customer-workflows/worker.ts"),
                {
                    defaultPolicy,
                } = require("../src/lib/inbox-operations/rules.ts"),
                operations = require("../src/lib/inbox-operations/repository.ts");
            Module._load = previousLoad;
            let checks = 0;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS ACCESS ${++checks} ${name}`);
            };
            const request = async (path, who = actor, method = "GET", body) => {
                const response = await dispatch(
                    "http://127.0.0.1:3120" + path,
                    {
                        method,
                        headers: {
                            authorization: `Bearer ${generateToken(who)}`,
                            origin: "http://127.0.0.1:3120",
                            "content-type": "application/json",
                        },
                        ...(body === undefined
                            ? {}
                            : { body: JSON.stringify(body) }),
                    },
                );
                const result = await response.json();
                return { status: response.status, ...result };
            };
            async function person(name) {
                const who = {
                    ...actor,
                    userId: randomUUID(),
                    name,
                    role: "member",
                };
                await db.insert(s.users).values({
                    id: who.userId,
                    orgId: actor.orgId,
                    name,
                    email: `${who.userId}@example.test`,
                    password: "isolated-only",
                });
                await db.insert(s.organizationMembers).values({
                    organizationId: actor.orgId,
                    userId: who.userId,
                    role: "member",
                });
                return who;
            }
            const employee = await person("가상 사업 직원"),
                second = await person("가상 백오피스 담당");
            const grant = async (who, role, workspaceId = 8) => {
                const [old] = await db
                    .select()
                    .from(s.customerWorkspaceAccess)
                    .where(
                        and(
                            eq(
                                s.customerWorkspaceAccess.workspaceId,
                                workspaceId,
                            ),
                            eq(s.customerWorkspaceAccess.userId, who.userId),
                        ),
                    );
                return access.changeAccess(
                    actor,
                    workspaceId,
                    { userId: who.userId, role, version: old?.version ?? 0 },
                    db,
                );
            };
            const session = await repo.startVisitorSession(
                channels.dh.publicKey,
                { name: "권한 시험 고객" },
                db,
            );
            const boSession = await repo.startVisitorSession(
                channels.bo.publicKey,
                { name: "백오피스 시험 고객" },
                db,
            );
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                session.token,
                { body: "권한 검수 문의", clientId: randomUUID() },
                db,
            );
            await repo.sendVisitorMessage(
                channels.bo.publicKey,
                boSession.token,
                { body: "백오피스 문의", clientId: randomUUID() },
                db,
            );
            const channelConfig = {
                workspaceId: 8,
                name: channels.dh.name,
                greeting: channels.dh.greeting,
                color: channels.dh.color,
                allowedOrigins: channels.dh.allowedOrigins,
                enabled: true,
            };
            let uploaded, mailbox;
            await check(
                "신규 일반 직원 기본 접근 없음·관리자 전체 사업 유지",
                async () => {
                    assert.equal(
                        (await request("/api/inbox", employee)).data.workspaces
                            .length,
                        0,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox?channelId=${channels.dh.id}`,
                                employee,
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-crm/contacts?workspaceId=8",
                                employee,
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (await request("/api/inbox", actor)).data.workspaces
                            .length,
                        2,
                    );
                },
            );
            await check(
                "조직 관리자만 배정·다른 조직과 관리자 역할 덮어쓰기 거절",
                async () => {
                    assert.equal(
                        (
                            await request(
                                "/api/customer-platform/access?workspaceId=8",
                                employee,
                            )
                        ).status,
                        403,
                    );
                    await assert.rejects(
                        access.changeAccess(
                            actor,
                            8,
                            {
                                userId: actor.userId,
                                role: "viewer",
                                version: 0,
                            },
                            db,
                        ),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        access.changeAccess(
                            actor,
                            9,
                            {
                                userId: employee.userId,
                                role: "viewer",
                                version: 0,
                            },
                            db,
                        ),
                        (e) => e.status === 404,
                    );
                    await assert.rejects(
                        access.changeAccess(
                            actor,
                            8,
                            {
                                userId: ctx.otherActor.userId,
                                role: "viewer",
                                version: 0,
                            },
                            db,
                        ),
                        (e) => e.status === 403,
                    );
                },
            );
            await check(
                "열람 배정과 사업별 bootstrap·응대 후보 분리",
                async () => {
                    await grant(employee, "viewer");
                    await grant(second, "agent", 10);
                    const b = (await request("/api/inbox", employee)).data;
                    assert.deepEqual(
                        b.workspaces.map((w) => w.id),
                        [8],
                    );
                    assert.deepEqual(b.workspaces[0].abilities, {
                        read: true,
                        respond: false,
                        manage: false,
                    });
                    assert.equal(b.canManageAccess, false);
                    assert.ok(!b.members.some((m) => m.id === second.userId));
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                employee,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${boSession.id}`,
                                employee,
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "열람 직원 조회·본인 읽음 허용, 답장·메모·편집 차단",
                async () => {
                    for (const kind of ["reply", "note"])
                        assert.equal(
                            (
                                await request(
                                    `/api/inbox/conversations/${session.id}`,
                                    employee,
                                    "POST",
                                    {
                                        kind,
                                        body: "금지",
                                        clientId: randomUUID(),
                                    },
                                )
                            ).status,
                            403,
                        );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                employee,
                                "PATCH",
                                { priority: true },
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                employee,
                                "POST",
                                { action: "read", customerSeq: 1 },
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-crm/contacts?workspaceId=8",
                                employee,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-crm/contacts",
                                employee,
                                "POST",
                                {
                                    workspaceId: 8,
                                    name: "금지",
                                    externalId: "forbidden",
                                },
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "열람 직원 첨부 조회 허용·업로드와 다른 사업 파일 차단",
                async () => {
                    const scope = await repo.staffFileScope(
                        actor,
                        session.id,
                        db,
                    );
                    uploaded = await files.uploadAttachment(
                        scope,
                        {
                            clientId: randomUUID(),
                            kind: "note",
                            fileName: "test.pdf",
                            bytes: Buffer.from("%PDF-1.4\nFAKE QA FILE"),
                        },
                        db,
                    );
                    await repo.sendAgentMessage(
                        actor,
                        session.id,
                        {
                            kind: "note",
                            body: "검수용 내부 파일",
                            clientId: randomUUID(),
                            attachmentIds: [uploaded.id],
                        },
                        db,
                    );
                    assert.equal(
                        (
                            await repo.staffDownloadScope(
                                employee,
                                uploaded.id,
                                db,
                            )
                        ).channelId,
                        channels.dh.id,
                    );
                    await assert.rejects(
                        repo.staffFileScope(employee, session.id, db),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        repo.staffDownloadScope(second, uploaded.id, db),
                        (e) => e.status === 403,
                    );
                },
            );
            await check(
                "설정·AI·자동화·이전·메일함·성과 전 경로 사업 격리",
                async () => {
                    const paths = [
                        "/api/customer-ai/settings?workspaceId=10",
                        "/api/customer-workflows?workspaceId=10",
                        "/api/customer-imports?workspaceId=10",
                        "/api/email-mailboxes?workspaceId=10",
                        "/api/customer-platform/webhooks?workspaceId=10",
                        `/api/inbox-operations/reports?channelId=${channels.bo.id}&from=2026-10-01&to=2026-10-15`,
                    ];
                    for (const path of paths)
                        assert.equal(
                            (await request(path, employee)).status,
                            403,
                            path,
                        );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-ai/settings?workspaceId=8",
                                employee,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox-operations/channels/${channels.dh.id}`,
                                employee,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-ai/settings",
                                employee,
                                "POST",
                                { workspaceId: 8 },
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "응대 역할 답장·메모·고객 편집 허용, 운영 설정 거절",
                async () => {
                    await grant(employee, "agent");
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                employee,
                                "POST",
                                {
                                    kind: "reply",
                                    body: "담당 직원 답변",
                                    clientId: randomUUID(),
                                },
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-crm/contacts",
                                employee,
                                "POST",
                                {
                                    workspaceId: 8,
                                    name: "가상 추가 고객",
                                    externalId: "access-qa-new",
                                },
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/inbox/channels",
                                employee,
                                "POST",
                                channelConfig,
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox-operations/channels/${channels.dh.id}`,
                                employee,
                                "POST",
                                { version: 0, policy: defaultPolicy() },
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-workflows",
                                employee,
                                "POST",
                                { workspaceId: 8 },
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                "/api/customer-platform/access?workspaceId=8",
                                employee,
                                "POST",
                                {
                                    userId: second.userId,
                                    role: "manager",
                                    version: 0,
                                },
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "담당 배정은 같은 사업의 현재 응대 직원만 허용",
                async () => {
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                actor,
                                "PATCH",
                                { assigneeId: second.userId },
                            )
                        ).status,
                        403,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                actor,
                                "PATCH",
                                { assigneeId: employee.userId },
                            )
                        ).status,
                        200,
                    );
                },
            );
            await check(
                "사업 운영 관리자는 조직 역할 승격 없이 설정·메일함 생성",
                async () => {
                    await grant(employee, "manager");
                    assert.equal(
                        (
                            await request(
                                "/api/inbox/channels",
                                employee,
                                "POST",
                                channelConfig,
                            )
                        ).status,
                        200,
                    );
                    assert.equal(
                        (
                            await request(
                                `/api/inbox-operations/channels/${channels.dh.id}`,
                                employee,
                                "POST",
                                { version: 0, policy: defaultPolicy() },
                            )
                        ).status,
                        200,
                    );
                    const response = await request(
                        "/api/email-mailboxes",
                        employee,
                        "POST",
                        {
                            workspaceId: 8,
                            name: "권한 시험 메일함",
                            address: "access@example.test",
                        },
                    );
                    assert.equal(response.status, 200);
                    mailbox = response.data;
                    const [m] = await db
                        .select()
                        .from(s.organizationMembers)
                        .where(
                            eq(s.organizationMembers.userId, employee.userId),
                        );
                    assert.equal(m.role, "member");
                    assert.equal(
                        (
                            await request(
                                "/api/customer-platform/access?workspaceId=8",
                                employee,
                            )
                        ).status,
                        403,
                    );
                },
            );
            await check(
                "권한 변경 CAS·무변경 저장 감사 제외·회수 tombstone",
                async () => {
                    const [old] = await db
                        .select()
                        .from(s.customerWorkspaceAccess)
                        .where(
                            eq(
                                s.customerWorkspaceAccess.userId,
                                employee.userId,
                            ),
                        );
                    const before = (
                        await db.select().from(s.customerAccessAudit)
                    ).length;
                    await access.changeAccess(
                        actor,
                        8,
                        {
                            userId: employee.userId,
                            role: "manager",
                            version: old.version,
                        },
                        db,
                    );
                    assert.equal(
                        (await db.select().from(s.customerAccessAudit)).length,
                        before,
                    );
                    await assert.rejects(
                        access.changeAccess(
                            actor,
                            8,
                            {
                                userId: employee.userId,
                                role: "none",
                                version: 0,
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    await grant(employee, "none");
                    await assert.rejects(
                        access.changeAccess(
                            actor,
                            8,
                            {
                                userId: employee.userId,
                                role: "manager",
                                version: old.version,
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "회수 즉시 본문·파일·리포트·기존 알림과 집계 차단",
                async () => {
                    assert.equal(
                        (
                            await request(
                                `/api/inbox/conversations/${session.id}`,
                                employee,
                            )
                        ).status,
                        403,
                    );
                    await assert.rejects(
                        repo.staffDownloadScope(employee, uploaded.id, db),
                        (e) => e.status === 403,
                    );
                    const notes = await operations.notificationsPage(
                        employee,
                        {},
                        db,
                    );
                    assert.equal(notes.rows.length, 0);
                    assert.equal(notes.unread, 0);
                    await repo.sendVisitorMessage(
                        channels.dh.publicKey,
                        session.token,
                        { body: "회수 뒤 문의", clientId: randomUUID() },
                        db,
                    );
                    const recent = await db
                        .select()
                        .from(s.inboxNotifications)
                        .where(
                            eq(s.inboxNotifications.conversationId, session.id),
                        )
                        .orderBy(desc(s.inboxNotifications.createdAt));
                    assert.notEqual(recent[0].userId, employee.userId);
                },
            );
            await check(
                "JWT 관리자 주장 대신 현재 DB 역할·세션 버전·비활성 사용",
                async () => {
                    assert.equal(
                        (
                            await request("/api/inbox", {
                                ...employee,
                                role: "owner",
                            })
                        ).data.workspaces.length,
                        0,
                    );
                    await grant(employee, "agent");
                    await db
                        .update(s.organizationMembers)
                        .set({ tokenVersion: 1 })
                        .where(
                            eq(s.organizationMembers.userId, employee.userId),
                        );
                    assert.equal(
                        (
                            await request("/api/inbox", {
                                ...employee,
                                tokenVersion: 0,
                            })
                        ).status,
                        401,
                    );
                    assert.equal(
                        (
                            await request("/api/inbox", {
                                ...employee,
                                tokenVersion: 1,
                            })
                        ).status,
                        200,
                    );
                    await db
                        .update(s.users)
                        .set({ isActive: 0 })
                        .where(eq(s.users.id, employee.userId));
                    assert.equal(
                        (
                            await request("/api/inbox", {
                                ...employee,
                                tokenVersion: 1,
                            })
                        ).status,
                        401,
                    );
                    await db
                        .update(s.users)
                        .set({ isActive: 1 })
                        .where(eq(s.users.id, employee.userId));
                    await db
                        .update(s.organizationMembers)
                        .set({ tokenVersion: 0 })
                        .where(
                            eq(s.organizationMembers.userId, employee.userId),
                        );
                },
            );
            await check(
                "API 토큰 범위와 발급자의 현재 사업 역할 교집합",
                async () => {
                    const token = await resolveApiToken(ctx.keys.dh);
                    await db
                        .update(s.apiTokens)
                        .set({ createdBy: employee.userId })
                        .where(eq(s.apiTokens.id, token.id));
                    assert.ok(
                        await clients.dh.request(
                            "/api/v1/crm/contacts?workspaceId=8",
                        ),
                    );
                    await assert.rejects(
                        clients.dh.request(
                            "/api/v1/inbox/channels",
                            "POST",
                            channelConfig,
                        ),
                        (e) => e.status === 403,
                    );
                    await grant(employee, "manager");
                    assert.ok(
                        await clients.dh.request(
                            "/api/v1/inbox/channels",
                            "POST",
                            channelConfig,
                        ),
                    );
                    await grant(employee, "none");
                    await assert.rejects(
                        clients.dh.request(
                            "/api/v1/crm/contacts?workspaceId=8",
                        ),
                        (e) => e.status === 403,
                    );
                    await db
                        .update(s.apiTokens)
                        .set({ createdBy: actor.userId })
                        .where(eq(s.apiTokens.id, token.id));
                },
            );
            await check(
                "권한 회수는 준비 중인 이메일의 공급자 전송을 차단",
                async () => {
                    await grant(employee, "agent");
                    mailbox = await email.changeMailbox(
                        actor,
                        mailbox.id,
                        { version: 1, enabled: true },
                        db,
                    );
                    const inbound = await email.receiveEmail(
                        actor,
                        mailbox.id,
                        {
                            providerMessageId: "access-in",
                            providerThreadId: "access-thread",
                            rfcMessageId: "<access-in@example.test>",
                            from: "customer@example.test",
                            to: [mailbox.address],
                            subject: "권한 시험",
                            body: "답변해주세요",
                            receivedAt: new Date().toISOString(),
                            files: [],
                        },
                        db,
                    );
                    const id = inbound.conversationId;
                    await repo.sendAgentMessage(
                        employee,
                        id,
                        {
                            kind: "reply",
                            body: "권한 회수 전 준비",
                            clientId: randomUUID(),
                        },
                        db,
                    );
                    const delivery = await email.claimEmail(
                        actor,
                        mailbox.id,
                        db,
                    );
                    assert.equal(delivery.state, "leased");
                    await grant(employee, "none");
                    await assert.rejects(
                        email.changeEmailDelivery(
                            actor,
                            delivery.id,
                            {
                                action: "begin",
                                leaseToken: delivery.leaseToken,
                            },
                            db,
                        ),
                        (e) => e.status === 403,
                    );
                    assert.equal(
                        await email.claimEmail(actor, mailbox.id, db),
                        null,
                    );
                    const [cancelled] = await db
                        .select()
                        .from(s.inboxEmailDeliveries)
                        .where(eq(s.inboxEmailDeliveries.id, delivery.id));
                    assert.equal(cancelled.state, "cancelled");
                    assert.equal(cancelled.errorCode, "access_revoked");
                },
            );
            await check(
                "사업 관리자가 게시한 자동화 실행·역할 회수 후 실행 중단",
                async () => {
                    await grant(employee, "manager");
                    const group = { mode: "all", rules: [] };
                    const flow = await workflows.saveWorkflow(
                        employee,
                        undefined,
                        {
                            workspaceId: 8,
                            version: 0,
                            name: "사업 권한 자동화",
                            description: "가상 QA",
                            definition: {
                                trigger: {
                                    types: ["customer.event"],
                                    eventName: "access.qa",
                                    when: group,
                                },
                                steps: [
                                    {
                                        id: randomUUID(),
                                        kind: "task",
                                        label: "후속",
                                        when: group,
                                        title: "권한 QA 업무",
                                        body: "가상",
                                        ownerId: employee.userId,
                                        dueMinutes: 60,
                                    },
                                ],
                            },
                        },
                        db,
                    );
                    const event = async () =>
                        clients.dh.track(8, contacts.dh.id, {
                            eventId: randomUUID(),
                            name: "access.qa",
                            properties: {},
                        });
                    await event();
                    const [source] = await db
                        .select()
                        .from(s.platformEvents)
                        .where(
                            and(
                                eq(s.platformEvents.type, "customer.event"),
                                eq(s.platformEvents.workspaceId, 8),
                            ),
                        )
                        .orderBy(desc(s.platformEvents.sequence));
                    const preview = await workflows.simulateWorkflow(
                        employee,
                        flow.workflow.id,
                        flow.revision.id,
                        source.id,
                        db,
                    );
                    assert.equal(preview.passed, true);
                    await workflows.publishWorkflow(
                        employee,
                        flow.workflow.id,
                        {
                            version: flow.workflow.version,
                            revisionId: flow.revision.id,
                            previewId: preview.id,
                            allowCustomerReplies: false,
                        },
                        db,
                    );
                    async function run() {
                        await event();
                        const [job] = await db
                            .select()
                            .from(s.customerWorkflowRuns)
                            .where(
                                eq(
                                    s.customerWorkflowRuns.workflowId,
                                    flow.workflow.id,
                                ),
                            )
                            .orderBy(desc(s.customerWorkflowRuns.createdAt));
                        for (let i = 0; i < 5; i++)
                            await processWorkflowRun(job.id, {
                                exec: db,
                                now: () => new Date(),
                            });
                        return (
                            await db
                                .select()
                                .from(s.customerWorkflowRuns)
                                .where(eq(s.customerWorkflowRuns.id, job.id))
                        )[0];
                    }
                    assert.equal((await run()).state, "succeeded");
                    await grant(employee, "agent");
                    assert.equal((await run()).state, "failed");
                },
            );
            await check(
                "사업 관리자 Google 연결 시작·승인 중 역할 회수 시 공급자 요청 차단",
                async () => {
                    await grant(employee, "manager");
                    const cfg = {
                        clientId: "fake-google-app",
                        clientSecret: "fake-only",
                        redirectUri:
                            "http://127.0.0.1:3120/api/email-google/callback",
                        encryptionKey: "isolated-only-key",
                    };
                    const started = await oauth.beginGoogleConnection(
                        employee,
                        mailbox.id,
                        { version: mailbox.version, lookbackDays: 0 },
                        "http://127.0.0.1:3120",
                        db,
                        cfg,
                    );
                    assert.ok(
                        started.authorizationUrl.startsWith(
                            "https://accounts.google.com/",
                        ),
                    );
                    await grant(employee, "agent");
                    let requests = 0;
                    await assert.rejects(
                        oauth.finishGoogleConnection(
                            employee,
                            {
                                state: new URL(
                                    started.authorizationUrl,
                                ).searchParams.get("state"),
                                cookie: started.cookie,
                                code: "fake-code",
                            },
                            db,
                            cfg,
                            async () => {
                                requests++;
                                throw new Error("Unexpected provider request");
                            },
                        ),
                        (e) => e.status === 403,
                    );
                    assert.equal(requests, 0);
                },
            );
            await check(
                "조직 탈퇴 직원 접근 폐기·감사 이력 사업별 보존",
                async () => {
                    await db
                        .delete(s.organizationMembers)
                        .where(
                            eq(s.organizationMembers.userId, employee.userId),
                        );
                    await assert.rejects(
                        requireCustomerAccess(employee, 8, "read", db),
                        (e) => e.status === 401,
                    );
                    const roster = await access.accessRoster(actor, 8, db);
                    assert.ok(
                        roster.history.some(
                            (h) => h.userId === employee.userId,
                        ),
                    );
                    assert.ok(
                        !roster.members.some((m) => m.id === employee.userId),
                    );
                    assert.equal(
                        (await access.accessRoster(actor, 10, db)).history.some(
                            (h) => h.userId === employee.userId,
                        ),
                        false,
                    );
                },
            );
            await check(
                "실제 마이그레이션 컬럼·역할/버전 제약·같은 시각 감사 50건 커서",
                async () => {
                    const { getTableConfig } = require("drizzle-orm/pg-core");
                    for (const table of [
                        s.customerWorkspaceAccess,
                        s.customerAccessAudit,
                    ]) {
                        const config = getTableConfig(table);
                        const columns = (
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
                    await assert.rejects(
                        db
                            .insert(s.customerWorkspaceAccess)
                            .values({
                                orgId: actor.orgId,
                                workspaceId: 8,
                                userId: second.userId,
                                role: "invalid",
                            }),
                    );
                    await assert.rejects(
                        db
                            .insert(s.customerWorkspaceAccess)
                            .values({
                                orgId: actor.orgId,
                                workspaceId: 8,
                                userId: second.userId,
                                role: "viewer",
                                version: 0,
                            }),
                    );
                    const before = (
                        await db
                            .select()
                            .from(s.customerAccessAudit)
                            .where(eq(s.customerAccessAudit.workspaceId, 8))
                    ).length;
                    await db
                        .insert(s.customerAccessAudit)
                        .values(
                            Array.from({ length: 51 }, (_, i) => ({
                                orgId: actor.orgId,
                                workspaceId: 8,
                                userId: employee.userId,
                                actorId: actor.userId,
                                actorName: actor.name,
                                beforeRole: "none",
                                afterRole: "viewer",
                                version: i + 1,
                                createdAt: new Date("2030-01-01"),
                            })),
                        );
                    const first = await access.accessRoster(actor, 8, db);
                    assert.equal(first.history.length, 50);
                    assert.equal(first.hasMore, true);
                    const next = await access.accessRoster(
                        actor,
                        8,
                        db,
                        first.history.at(-1).id,
                    );
                    assert.equal(next.history.length, before + 1);
                    assert.ok(
                        !next.history.some((n) =>
                            first.history.some((f) => f.id === n.id),
                        ),
                    );
                    await assert.rejects(
                        access.accessRoster(actor, 10, db, first.history[0].id),
                        (e) => e.status === 404,
                    );
                },
            );
            console.log(
                `사업 직원 권한 SQL/API QA ${checks}개 통과 · 실제 고객/외부 전송/운영 DB 접근 0건`,
            );
            if (extra) await extra({ ...ctx, accessChecks: checks });
            else await pg.close();
        },
    );
}
if (require.main === module)
    runAccessCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runAccessCheck };
