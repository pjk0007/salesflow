/* eslint-disable @typescript-eslint/no-require-imports -- 격리 SQL·가상 고객만 사용하는 상담 운영 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto"),
    Module = require("node:module");
async function runOperationsCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const {
                    db,
                    pg,
                    actor,
                    otherActor,
                    channels,
                    clients,
                    repo,
                    dispatch,
                } = ctx,
                s = require("../src/lib/db/schema.ts"),
                { eq } = require("drizzle-orm"),
                originalLoad = Module._load;
            Module._load = function (name, parent) {
                const resolved = Module._resolveFilename(
                    name,
                    parent,
                ).replaceAll("\\", "/");
                if (resolved.endsWith("/src/lib/db/index.ts"))
                    return { ...s, db };
                return originalLoad.apply(this, arguments);
            };
            const ops = require("../src/lib/inbox-operations/repository.ts"),
                {
                    operationsReport,
                } = require("../src/lib/inbox-operations/reports.ts"),
                {
                    processOperationsQueue,
                } = require("../src/lib/inbox-operations/worker.ts"),
                { appendInboxAudit } = require("../src/lib/inbox/audit.ts"),
                {
                    enqueuePlatformEvent,
                } = require("../src/lib/customer-platform/outbox.ts"),
                {
                    defaultPolicy,
                } = require("../src/lib/inbox-operations/rules.ts"),
                {
                    defaultCalendar,
                } = require("../src/lib/inbox-operations/calendar.ts"),
                email = require("../src/lib/inbox-email/repository.ts"),
                { generateToken } = require("../src/lib/auth.ts"),
                {
                    linkVisitorIdentity,
                } = require("../src/lib/inbox/link-identity.ts");
            Module._load = originalLoad;
            const b = {
                    ...actor,
                    userId: randomUUID(),
                    name: "가상 윤지",
                    role: "member",
                },
                inactive = {
                    ...actor,
                    userId: randomUUID(),
                    name: "비활성 상담원",
                };
            await db.insert(s.users).values([
                {
                    id: b.userId,
                    orgId: actor.orgId,
                    name: b.name,
                    email: "agent-b@example.test",
                    password: "fake-only",
                },
                {
                    id: inactive.userId,
                    orgId: actor.orgId,
                    name: inactive.name,
                    email: "inactive@example.test",
                    password: "fake-only",
                    isActive: 0,
                },
            ]);
            await db.insert(s.organizationMembers).values([
                {
                    organizationId: actor.orgId,
                    userId: b.userId,
                    role: "member",
                },
                {
                    organizationId: actor.orgId,
                    userId: inactive.userId,
                    role: "member",
                },
            ]);
            await db.insert(s.customerWorkspaceAccess).values([8,10].map(workspaceId => ({ orgId: actor.orgId, workspaceId, userId: b.userId, role: "agent" })));
            const dt = (v) => new Date(v),
                at = (day, time) => dt(`2026-10-${day}T${time}:00+09:00`),
                policy = {
                    ...defaultPolicy(),
                    enabled: true,
                    showHours: true,
                    calendar: defaultCalendar(),
                    firstMinutes: 15,
                    nextMinutes: 15,
                    resolutionMinutes: 60,
                },
                auth = {
                    authorization: `Bearer ${generateToken(actor)}`,
                    "content-type": "application/json",
                    origin: "http://127.0.0.1:3120",
                };
            let checks = 0,
                session,
                boSession,
                settings;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS OPERATIONS ${++checks} ${name}`);
            };
            const sessions = async (name, channel = channels.dh) => ({
                ...(await repo.startVisitorSession(
                    channel.publicKey,
                    { name },
                    db,
                )),
                key: channel.publicKey,
            });
            const customer = async (
                session,
                time,
                body = "가상 고객 문의",
                clientId = randomUUID(),
            ) =>
                repo.appendMessage(
                    db,
                    session.id,
                    {
                        clientId,
                        kind: "customer",
                        body,
                        authorName: "가상 고객",
                        attachmentIds: [],
                        createdAt: time,
                    },
                    await repo.visitorFileScope(session.key, session.token, db),
                );
            const reply = async (
                session,
                time,
                body = "가상 상담원 답변",
                kind = "reply",
                human = true,
            ) =>
                repo.appendMessage(
                    db,
                    session.id,
                    {
                        clientId: randomUUID(),
                        kind,
                        body,
                        authorName: human ? actor.name : "가상 AI",
                        ...(human ? { authorId: actor.userId } : {}),
                        attachmentIds: [],
                        createdAt: time,
                    },
                    await repo.staffFileScope(actor, session.id, db),
                );
            const casesFor = async (id) =>
                (
                    await db
                        .select()
                        .from(s.inboxServiceCases)
                        .where(eq(s.inboxServiceCases.conversationId, id))
                ).sort((a, b) => a.startedAt - b.startedAt);
            const obligationsFor = async (id) => {
                const cs = await casesFor(id);
                return (await db.select().from(s.inboxResponseObligations))
                    .filter((o) => cs.some((c) => c.id === o.caseId))
                    .sort((a, b) => a.startedAt - b.startedAt);
            };
            const noticesFor = async (id) =>
                await db
                    .select()
                    .from(s.inboxNotifications)
                    .where(eq(s.inboxNotifications.conversationId, id));
            const change = async (session, status, time, assigneeId) =>
                db.transaction(async (tx) => {
                    const [old] = await tx
                        .select()
                        .from(s.inboxConversations)
                        .where(eq(s.inboxConversations.id, session.id))
                        .for("update");
                    const changes = {};
                    if (status !== undefined && status !== old.status)
                        changes.status = { before: old.status, after: status };
                    if (
                        assigneeId !== undefined &&
                        assigneeId !== old.assigneeId
                    )
                        changes.assigneeId = {
                            before: old.assigneeId,
                            after: assigneeId,
                        };
                    await tx
                        .update(s.inboxConversations)
                        .set({
                            ...(status !== undefined ? { status } : {}),
                            ...(assigneeId !== undefined ? { assigneeId } : {}),
                            version: old.version + 1,
                        })
                        .where(eq(s.inboxConversations.id, old.id));
                    await appendInboxAudit(tx, {
                        orgId: actor.orgId,
                        channelId: old.channelId,
                        conversationId: old.id,
                        actorId: actor.userId,
                        actorName: actor.name,
                        action: "conversation.updated",
                        changes,
                        createdAt: time,
                    });
                });
            const query = (id, from = "2026-10-19", to = from, extra = {}) =>
                operationsReport(
                    actor,
                    id,
                    { from, to, ...extra },
                    db,
                    at(20, "12:00"),
                );
            try {
                await check(
                    "기본 중지·관리자/사업 범위 API·CAS·잘못된 달력 거절",
                    async () => {
                        assert.equal(
                            (
                                await ops.operationsSettings(
                                    actor,
                                    channels.dh.id,
                                    db,
                                )
                            ).policy.enabled,
                            false,
                        );
                        settings = await clients.dh.saveSupportSettings(
                            channels.dh.id,
                            0,
                            policy,
                        );
                        assert.equal(settings.version, 1);
                        assert.equal(settings.workerEnabled, false);
                        await assert.rejects(
                            ops.saveOperationsSettings(
                                actor,
                                channels.dh.id,
                                {
                                    version: 1,
                                    policy: {
                                        ...policy,
                                        resolutionMinutes: 43200,
                                        calendar: {
                                            timezone: "Asia/Seoul",
                                            weekly: [
                                                {
                                                    day: 1,
                                                    start: "09:00",
                                                    end: "09:01",
                                                },
                                            ],
                                            holidays: [],
                                        },
                                    },
                                },
                                db,
                            ),
                        );
                        await assert.rejects(
                            clients.bo.supportSettings(channels.dh.id),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            clients.read.saveSupportSettings(
                                channels.dh.id,
                                1,
                                policy,
                            ),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            ops.saveOperationsSettings(
                                b,
                                channels.dh.id,
                                { version: 1, policy },
                                db,
                            ),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            ops.saveOperationsSettings(
                                actor,
                                channels.dh.id,
                                { version: 0, policy },
                                db,
                            ),
                            (e) => e.status === 409,
                        );
                        await assert.rejects(
                            ops.saveOperationsSettings(
                                actor,
                                channels.dh.id,
                                {
                                    version: 1,
                                    policy: {
                                        ...policy,
                                        calendar: {
                                            ...policy.calendar,
                                            weekly: [],
                                        },
                                    },
                                },
                                db,
                            ),
                        );
                    },
                );
                await check(
                    "새 문의·알림·응대·목표 원자 저장과 clientId 중복",
                    async () => {
                        session = await sessions("운영 QA 첫 고객");
                        const id = randomUUID(),
                            before = await noticesFor(session.id);
                        await customer(session, at(19, "09:00"), "첫 문의", id);
                        await customer(session, at(19, "09:00"), "첫 문의", id);
                        const cs = await casesFor(session.id);
                        assert.equal(cs.length, 1);
                        assert.equal(cs[0].slaApplied, true);
                        assert.equal(
                            (
                                await obligationsFor(session.id)
                            )[0].dueAt.toISOString(),
                            at(19, "09:15").toISOString(),
                        );
                        const ns = await noticesFor(session.id);
                        assert.equal(ns.length - before.length, 2);
                        assert.deepEqual(
                            new Set(ns.map((n) => n.userId)),
                            new Set([actor.userId, b.userId]),
                        );
                    },
                );
                await check(
                    "추가 질문·메모·AI 기본 제외는 첫 응답 시한을 밀거나 충족하지 않음",
                    async () => {
                        await customer(session, at(19, "09:05"), "추가 질문");
                        const count = (await noticesFor(session.id)).length;
                        await reply(
                            session,
                            at(19, "09:06"),
                            "비공개 메모",
                            "note",
                        );
                        await reply(
                            session,
                            at(19, "09:07"),
                            "가상 AI 답변",
                            "reply",
                            false,
                        );
                        assert.equal(
                            (await noticesFor(session.id)).length,
                            count,
                        );
                        const waits = await obligationsFor(session.id);
                        assert.equal(waits.length, 1);
                        assert.equal(waits[0].respondedAt, null);
                        assert.equal(
                            waits[0].dueAt.toISOString(),
                            at(19, "09:15").toISOString(),
                        );
                    },
                );
                await check(
                    "첫 상담원 답변·추가 답변 의무·표본·중앙값",
                    async () => {
                        await reply(session, at(19, "09:10"));
                        assert.equal(
                            (await casesFor(session.id))[0].firstReplyMs,
                            600000,
                        );
                        await customer(session, at(19, "09:11"), "다음 질문");
                        const os = await obligationsFor(session.id);
                        assert.equal(os.length, 2);
                        assert.equal(os[1].kind, "next");
                        assert.equal(
                            os[1].dueAt.toISOString(),
                            at(19, "09:26").toISOString(),
                        );
                        const r = await query(channels.dh.id);
                        assert.equal(r.summary.firstReplySamples, 1);
                        assert.equal(r.summary.firstReplyMedianMs, 600000);
                        assert.equal(
                            r.response.find((r) => r.kind === "first").met,
                            1,
                        );
                    },
                );
                await check(
                    "보류 시간 제외·재개 후 목표 이동·기존 기준으로 답변과 해결 집계",
                    async () => {
                        await change(session, "snoozed", at(19, "09:15"));
                        await processOperationsQueue({
                            exec: db,
                            now: () => at(20, "09:00"),
                        });
                        assert.equal(
                            (await noticesFor(session.id)).filter((n) =>
                                n.type.startsWith("sla_"),
                            ).length,
                            0,
                        );
                        await change(session, "open", at(20, "09:05"));
                        assert.equal(
                            (
                                await obligationsFor(session.id)
                            )[1].dueAt.toISOString(),
                            at(20, "09:16").toISOString(),
                        );
                        await reply(session, at(20, "09:10"));
                        await change(session, "closed", at(20, "09:20"));
                        const c = (await casesFor(session.id))[0];
                        assert.equal(c.resolutionMs, 30 * 60000);
                        assert.equal(c.pausedMs, 530 * 60000);
                        assert.equal(
                            (await obligationsFor(session.id))[1].elapsedMs,
                            9 * 60000,
                        );
                    },
                );
                await check(
                    "알림 클릭·읽음 순번·다른 사용자 알림 거절·새 문의 보존",
                    async () => {
                        const all = await ops.notificationsPage(actor, {}, db),
                            mine = all.rows.filter(
                                (r) => r.conversationId === session.id,
                            );
                        assert.ok(mine.some((r) => !r.readAt));
                        await repo.markRead(actor, session.id, 2, db);
                        let page = await ops.notificationsPage(actor, {}, db);
                        assert.equal(
                            page.rows.filter(
                                (r) =>
                                    r.conversationId === session.id &&
                                    !r.readAt &&
                                    r.type === "customer",
                            ).length,
                            1,
                        );
                        await repo.markRead(actor, session.id, 3, db);
                        page = await ops.notificationsPage(actor, {}, db);
                        assert.equal(
                            page.rows.filter(
                                (r) =>
                                    r.conversationId === session.id &&
                                    !r.readAt &&
                                    r.type === "customer",
                            ).length,
                            0,
                        );
                        const other = (await noticesFor(session.id)).find(
                            (n) => n.userId === b.userId,
                        );
                        await assert.rejects(
                            ops.readNotifications(
                                actor,
                                { action: "read", ids: [other.id] },
                                undefined,
                                db,
                            ),
                            (e) => e.status === 404,
                        );
                    },
                );
                await check(
                    "배정 알림·새 문의 담당자만 수신·비활성 직원 제외",
                    async () => {
                        await change(
                            session,
                            "open",
                            at(20, "09:25"),
                            b.userId,
                        );
                        await customer(session, at(20, "09:30"), "재문의");
                        const rows = await noticesFor(session.id);
                        assert.equal(
                            rows.filter((n) => n.type === "assigned").length,
                            1,
                        );
                        assert.equal(
                            rows.find((n) => n.type === "assigned").userId,
                            b.userId,
                        );
                        const latest = rows
                            .filter((n) => n.type === "customer")
                            .sort((a, b) => b.customerSeq - a.customerSeq);
                        assert.equal(latest[0].userId, b.userId);
                        assert.ok(
                            !latest.some(
                                (n) =>
                                    n.customerSeq === 4 &&
                                    n.userId === actor.userId,
                            ),
                        );
                        assert.ok(
                            !rows.some((n) => n.userId === inactive.userId),
                        );
                        assert.equal((await casesFor(session.id)).length, 2);
                    },
                );
                let late;
                await check(
                    "주말·휴무일 목표와 초과 알림·중복 워커 멱등",
                    async () => {
                        let current = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            {
                                version: current.version,
                                policy: {
                                    ...policy,
                                    calendar: {
                                        ...policy.calendar,
                                        holidays: ["2026-10-19"],
                                    },
                                },
                            },
                            db,
                        );
                        late = await sessions("마감 직전 QA 고객");
                        await customer(late, at(16, "17:50"));
                        assert.equal(
                            (
                                await obligationsFor(late.id)
                            )[0].dueAt.toISOString(),
                            at(20, "09:05").toISOString(),
                        );
                        await processOperationsQueue({
                            exec: db,
                            now: () => at(20, "09:05"),
                        });
                        assert.equal(
                            (await noticesFor(late.id)).filter(
                                (n) => n.type === "sla_first",
                            ).length,
                            0,
                        );
                        await processOperationsQueue({
                            exec: db,
                            now: () => at(20, "09:06"),
                        });
                        const before = (await noticesFor(late.id)).filter(
                            (n) => n.type === "sla_first",
                        ).length;
                        assert.equal(before, 2);
                        await processOperationsQueue({
                            exec: db,
                            now: () => at(20, "09:07"),
                        });
                        assert.equal(
                            (await noticesFor(late.id)).filter(
                                (n) => n.type === "sla_first",
                            ).length,
                            before,
                        );
                    },
                );
                await check(
                    "설정 변경은 진행 중 기준 보존·중지는 새 초과 알림 차단",
                    async () => {
                        const old = (await casesFor(late.id))[0],
                            current = await ops.operationsSettings(
                                actor,
                                channels.dh.id,
                                db,
                            );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            {
                                version: current.version,
                                policy: {
                                    ...policy,
                                    enabled: false,
                                    firstMinutes: 1,
                                },
                            },
                            db,
                        );
                        await processOperationsQueue({
                            exec: db,
                            now: () => at(22, "12:00"),
                        });
                        assert.equal(
                            (await noticesFor(late.id)).filter(
                                (n) => n.type === "sla_resolution",
                            ).length,
                            0,
                        );
                        assert.deepEqual(
                            (await casesFor(late.id))[0].policy,
                            old.policy,
                        );
                        const p = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            { version: p.version, policy },
                            db,
                        );
                    },
                );
                await check(
                    "미응답 종료는 준수로 계산하지 않음·목표 초과를 숨기지 않음",
                    async () => {
                        await change(late, "closed", at(20, "10:00"));
                        const r = await query(channels.dh.id, "2026-10-16");
                        assert.equal(r.summary.closedUnanswered, 1);
                        assert.equal(
                            r.response.find((x) => x.kind === "first").met,
                            0,
                        );
                        assert.equal(
                            r.response.find((x) => x.kind === "first")
                                .closedUnanswered,
                            1,
                        );
                        assert.equal(r.summary.resolutionMissed, 1);
                    },
                );
                await check(
                    "내부 고객·과거 상담·외부 원본 이벤트는 알림과 지표에서 제외",
                    async () => {
                        const c = await clients.dh.upsertContact({
                                workspaceId: 8,
                                externalId: "internal-operations",
                                name: "내부 QA",
                                isInternal: true,
                            }),
                            identity = await clients.dh.customerIdentity(
                                channels.dh.id,
                                c.id,
                            );
                        // Member sessions create their conversation on first actual inquiry.
                        await repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { clientId: randomUUID(), body: "내부 QA 문의" },
                            db,
                        );
                        const all = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(eq(s.inboxConversations.contactId, c.id));
                        assert.equal((await casesFor(all[0].id)).length, 0);
                        assert.equal((await noticesFor(all[0].id)).length, 0);
                        const history = await sessions("과거 이력 QA");
                        await db
                            .update(s.inboxConversations)
                            .set({ historyOnly: true })
                            .where(eq(s.inboxConversations.id, history.id));
                        await db.transaction((tx) =>
                            enqueuePlatformEvent(tx, {
                                orgId: actor.orgId,
                                workspaceId: 8,
                                key: "qa-history-op",
                                type: "message.created",
                                data: {
                                    conversationId: history.id,
                                    message: { id: 999 },
                                },
                            }),
                        );
                        assert.equal((await casesFor(history.id)).length, 0);
                    },
                );
                await check(
                    "후에 내부로 분류된 고객의 기존 알림·성과도 숨김",
                    async () => {
                        const c = await clients.dh.upsertContact({
                                workspaceId: 8,
                                externalId: "late-internal-operations",
                                name: "분류 QA",
                            }),
                            identity = await clients.dh.customerIdentity(
                                channels.dh.id,
                                c.id,
                            );
                        await repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { clientId: randomUUID(), body: "분류 전 문의" },
                            db,
                        );
                        const [chat] = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(eq(s.inboxConversations.contactId, c.id));
                        assert.ok((await noticesFor(chat.id)).length);
                        await clients.dh.upsertContact({
                            workspaceId: 8,
                            externalId: c.externalId,
                            name: c.name,
                            isInternal: true,
                        });
                        assert.ok(
                            !(
                                await ops.notificationsPage(actor, {}, db)
                            ).rows.some((n) => n.conversationId === chat.id),
                        );
                    },
                );
                await check(
                    "AI 응답 포함은 선택한 새 응대에만 적용",
                    async () => {
                        const current = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            {
                                version: current.version,
                                policy: { ...policy, includeAi: true },
                            },
                            db,
                        );
                        const ai = await sessions("AI 포함 QA");
                        await customer(ai, at(21, "09:00"));
                        await reply(
                            ai,
                            at(21, "09:03"),
                            "가상 AI 자동 답변",
                            "reply",
                            false,
                        );
                        const c = (await casesFor(ai.id))[0];
                        assert.equal(c.firstReplyMs, 180000);
                        assert.equal(c.firstResponder, "ai");
                        const next = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            { version: next.version, policy },
                            db,
                        );
                    },
                );
                await check(
                    "보류 전에 이미 초과된 목표는 재개해도 초과 유지",
                    async () => {
                        const test = await sessions("보류 전 초과 QA");
                        await customer(test, at(22, "09:00"));
                        await change(test, "snoozed", at(22, "09:20"));
                        await change(test, "open", at(22, "10:20"));
                        assert.equal(
                            (
                                await obligationsFor(test.id)
                            )[0].dueAt.toISOString(),
                            at(22, "09:15").toISOString(),
                        );
                        await reply(test, at(22, "10:25"));
                        assert.ok(
                            (await obligationsFor(test.id))[0].breachedAt,
                        );
                    },
                );
                await check(
                    "회원 이력 병합은 두 응대와 시한 보존·새 답변이 대기 모두 충족",
                    async () => {
                        const contact = await clients.dh.upsertContact({
                                workspaceId: 8,
                                externalId: "operations-merge",
                                name: "회원 병합 QA",
                            }),
                            identity = await clients.dh.customerIdentity(
                                channels.dh.id,
                                contact.id,
                            );
                        await repo.sendVisitorMessage(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { clientId: randomUUID(), body: "회원 기존 문의" },
                            db,
                        );
                        const [member] = await db
                                .select()
                                .from(s.inboxConversations)
                                .where(
                                    eq(
                                        s.inboxConversations.contactId,
                                        contact.id,
                                    ),
                                ),
                            anon = await sessions("병합 비회원 QA");
                        await customer(anon, at(22, "09:00"));
                        await linkVisitorIdentity(
                            channels.dh.publicKey,
                            identity.identityToken,
                            { action: "identify", anonymousToken: anon.token },
                            db,
                        );
                        const cs = await casesFor(member.id);
                        assert.equal(cs.length, 2);
                        assert.equal(
                            (await noticesFor(anon.id)).filter((n) => !n.readAt)
                                .length,
                            0,
                        );
                        assert.equal(
                            (await noticesFor(member.id)).filter(
                                (n) => n.type === "identity",
                            ).length,
                            2,
                        );
                        await reply(
                            { ...anon, id: member.id },
                            at(22, "09:10"),
                        );
                        assert.equal(
                            (await obligationsFor(member.id)).filter(
                                (o) => !o.respondedAt,
                            ).length,
                            0,
                        );
                    },
                );
                await check(
                    "두 사업의 정책·알림·성과와 서비스 토큰 격리",
                    async () => {
                        const saved = await clients.bo.saveSupportSettings(
                                channels.bo.id,
                                0,
                                { ...policy, firstMinutes: 30 },
                            ),
                            test = await sessions(
                                "백오랩 운영 QA",
                                channels.bo,
                            );
                        boSession = test;
                        assert.equal(saved.policy.firstMinutes, 30);
                        await customer(test, at(19, "10:00"));
                        assert.equal(
                            (
                                await obligationsFor(test.id)
                            )[0].dueAt.toISOString(),
                            at(19, "10:30").toISOString(),
                        );
                        const result = await clients.bo.supportReport(
                            channels.bo.id,
                            { from: "2026-10-19", to: "2026-10-19" },
                        );
                        assert.equal(result.summary.started, 1);
                        assert.ok(
                            !result.rows.some(
                                (r) => r.conversationId === session.id,
                            ),
                        );
                        await assert.rejects(
                            clients.dh.supportReport(channels.bo.id, {
                                from: "2026-10-19",
                                to: "2026-10-19",
                            }),
                            (e) => e.status === 403,
                        );
                    },
                );
                await check(
                    "이메일 대기는 응답 아님·본문 준비 후 새 질문은 별도 대기",
                    async () => {
                        const current = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            {
                                version: current.version,
                                policy: {
                                    ...policy,
                                    calendar: {
                                        timezone: "Asia/Seoul",
                                        weekly: [0, 1, 2, 3, 4, 5, 6].map(
                                            (day) => ({
                                                day,
                                                start: "00:00",
                                                end: "24:00",
                                            }),
                                        ),
                                        holidays: [],
                                    },
                                },
                            },
                            db,
                        );
                        let box = await email.createMailbox(
                            actor,
                            {
                                workspaceId: 8,
                                address: "operations-help@example.test",
                                name: "운영 QA 메일",
                            },
                            db,
                        );
                        box = await email.changeMailbox(
                            actor,
                            box.id,
                            { version: box.version, enabled: true },
                            db,
                        );
                        const base = Date.now(),
                            input = (n, delta) => ({
                                providerMessageId: "operations-email-" + n,
                                providerThreadId: "operations-email-thread",
                                rfcMessageId: `<operations-${n}@example.test>`,
                                from: "lead-email@example.test",
                                to: [box.address],
                                body: "이메일 문의 " + n,
                                receivedAt: new Date(
                                    base + delta,
                                ).toISOString(),
                            });
                        const first = await email.receiveEmail(
                                actor,
                                box.id,
                                input(1, -150000),
                                db,
                            ),
                            mail = { id: first.conversationId };
                        await reply(mail, new Date(base - 120000));
                        assert.equal(
                            (await obligationsFor(mail.id))[0].respondedAt,
                            null,
                        );
                        await email.receiveEmail(
                            actor,
                            box.id,
                            input(2, -90000),
                            db,
                        );
                        assert.equal((await obligationsFor(mail.id)).length, 2);
                        const delivery = await email.claimEmail(
                            actor,
                            box.id,
                            db,
                            new Date(base - 61000),
                        );
                        await email.changeEmailDelivery(
                            actor,
                            delivery.id,
                            {
                                action: "begin",
                                leaseToken: delivery.leaseToken,
                            },
                            db,
                            new Date(base - 61000),
                        );
                        await email.changeEmailDelivery(
                            actor,
                            delivery.id,
                            {
                                action: "sent",
                                leaseToken: delivery.leaseToken,
                                providerMessageId: "fake-operations-sent",
                            },
                            db,
                            new Date(base - 60000),
                        );
                        let os = await obligationsFor(mail.id);
                        assert.equal(os[0].elapsedMs, 90000);
                        assert.equal(os[1].respondedAt, null);
                        await change(mail, "closed", new Date(base));
                        await email.receiveEmail(
                            actor,
                            box.id,
                            input(0, -180000),
                            db,
                        );
                        const [chat] = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(eq(s.inboxConversations.id, mail.id));
                        assert.equal(chat.status, "closed");
                        assert.equal(chat.preview, "이메일 문의 2");
                        assert.equal((await casesFor(mail.id)).length, 1);
                        assert.equal(
                            (await casesFor(mail.id))[0].firstReplyMs,
                            120000,
                        );
                        const r = await query(
                            channels.dh.id,
                            new Date(base).toLocaleDateString("en-CA", {
                                timeZone: "Asia/Seoul",
                            }),
                            undefined,
                            { medium: "email" },
                        );
                        assert.equal(r.summary.started, 1);
                        assert.equal(
                            r.response.find((r) => r.kind === "next")
                                .closedUnanswered,
                            1,
                        );
                    },
                );
                await check(
                    "적용 이전 원본이 뒤늦게 확인되면 지표를 보정하고 초과 알림을 정리",
                    async () => {
                        const current = await ops.operationsSettings(
                            actor,
                            channels.dh.id,
                            db,
                        );
                        await ops.saveOperationsSettings(
                            actor,
                            channels.dh.id,
                            {
                                version: current.version,
                                policy: {
                                    ...current.policy,
                                    firstMinutes: 1,
                                    resolutionMinutes: 1,
                                },
                            },
                            db,
                        );
                        let box = await email.createMailbox(
                            actor,
                            {
                                workspaceId: 8,
                                address: "late-source-operations@example.test",
                                name: "늦은 원본 QA",
                            },
                            db,
                        );
                        box = await email.changeMailbox(
                            actor,
                            box.id,
                            { version: box.version, enabled: true },
                            db,
                        );
                        const base = Date.now(),
                            input = (id, offset) => ({
                                providerMessageId: "late-original-" + id,
                                providerThreadId: "late-original-thread",
                                rfcMessageId: `<late-original-${id}@example.test>`,
                                from: "late-lead@example.test",
                                to: [box.address],
                                body: "늦은 원본 QA " + id,
                                receivedAt: new Date(
                                    base + offset,
                                ).toISOString(),
                            });
                        const receipt = await email.receiveEmail(
                                actor,
                                box.id,
                                input(1, 10000),
                                db,
                            ),
                            test = { id: receipt.conversationId };
                        await processOperationsQueue({
                            exec: db,
                            now: () => new Date(base + 80000),
                        });
                        assert.ok(
                            (await noticesFor(test.id)).some(
                                (n) => n.type === "sla_first" && !n.readAt,
                            ),
                        );
                        await reply(test, new Date(base + 20000));
                        const delivery = await email.claimEmail(
                            actor,
                            box.id,
                            db,
                            new Date(base + 30000),
                        );
                        await email.changeEmailDelivery(
                            actor,
                            delivery.id,
                            {
                                action: "begin",
                                leaseToken: delivery.leaseToken,
                            },
                            db,
                            new Date(base + 30000),
                        );
                        await email.changeEmailDelivery(
                            actor,
                            delivery.id,
                            {
                                action: "sent",
                                leaseToken: delivery.leaseToken,
                                providerMessageId: "late-fake-sent",
                            },
                            db,
                            new Date(base + 90000),
                        );
                        await change(test, "closed", new Date(base + 100000));
                        await email.receiveEmail(
                            actor,
                            box.id,
                            input(0, -10000),
                            db,
                        );
                        const c = (await casesFor(test.id))[0];
                        assert.equal(c.slaApplied, false);
                        assert.equal(c.resolutionDueAt, null);
                        assert.equal(c.resolutionBreachedAt, null);
                        assert.equal(c.firstReplyMs, 100000);
                        assert.ok(
                            (await obligationsFor(test.id)).every(
                                (o) =>
                                    o.dueAt === null && o.breachedAt === null,
                            ),
                        );
                        assert.ok(
                            (await noticesFor(test.id))
                                .filter((n) => n.type.startsWith("sla_"))
                                .every((n) => !!n.readAt),
                        );
                    },
                );
                await check(
                    "원본 저장 실패는 알림·메시지·응대·플랫폼 이벤트 모두 롤백",
                    async () => {
                        const test = await sessions("원자 롤백 QA"),
                            count = async (table) =>
                                (await db.select().from(table)).length,
                            tables = [
                                s.inboxMessages,
                                s.inboxServiceCases,
                                s.inboxResponseObligations,
                                s.inboxNotifications,
                                s.platformEvents,
                            ],
                            before = await Promise.all(tables.map(count));
                        await pg.exec(
                            "CREATE FUNCTION qa_fail_ops_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.preview='원자 실패' THEN RAISE EXCEPTION 'qa notice rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_ops_notice BEFORE INSERT ON inbox_notifications FOR EACH ROW EXECUTE FUNCTION qa_fail_ops_notice();",
                        );
                        await assert.rejects(
                            customer(test, at(23, "09:00"), "원자 실패"),
                        );
                        assert.deepEqual(
                            await Promise.all(tables.map(count)),
                            before,
                        );
                        await pg.exec(
                            "DROP TRIGGER qa_fail_ops_notice ON inbox_notifications; DROP FUNCTION qa_fail_ops_notice();",
                        );
                    },
                );
                await check(
                    "정책·감사 원자 저장과 공개 업무시간·다음 시작 안내",
                    async () => {
                        const current = await ops.operationsSettings(
                            actor,
                            channels.bo.id,
                            db,
                        );
                        await pg.exec(
                            "CREATE FUNCTION qa_fail_ops_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='operations.settings.updated' THEN RAISE EXCEPTION 'qa settings rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_ops_settings BEFORE INSERT ON inbox_audit_events FOR EACH ROW EXECUTE FUNCTION qa_fail_ops_settings();",
                        );
                        await assert.rejects(
                            ops.saveOperationsSettings(
                                actor,
                                channels.bo.id,
                                {
                                    version: current.version,
                                    policy: {
                                        ...current.policy,
                                        firstMinutes: 1,
                                    },
                                },
                                db,
                            ),
                        );
                        assert.equal(
                            (
                                await ops.operationsSettings(
                                    actor,
                                    channels.bo.id,
                                    db,
                                )
                            ).version,
                            current.version,
                        );
                        await pg.exec(
                            "DROP TRIGGER qa_fail_ops_settings ON inbox_audit_events; DROP FUNCTION qa_fail_ops_settings();",
                        );
                        const hours = await ops.publicBusinessHours(
                            channels.bo.id,
                            db,
                            at(16, "18:00"),
                        );
                        assert.equal(hours.open, false);
                        assert.equal(
                            hours.nextOpenAt,
                            at(19, "09:00").toISOString(),
                        );
                        const res = await dispatch(
                            `http://127.0.0.1:3120/api/messenger/${channels.bo.publicKey}`,
                        );
                        const dto = (await res.json()).data;
                        assert.ok(dto.businessHours);
                        assert.ok(
                            !JSON.stringify(dto).includes("firstMinutes"),
                        );
                    },
                );
                await check(
                    "개인 알림 API 인증·Origin·직원 권한 회수·다른 조직 차단",
                    async () => {
                        assert.equal(
                            (
                                await dispatch(
                                    "http://127.0.0.1:3120/api/inbox-notifications",
                                )
                            ).status,
                            401,
                        );
                        assert.equal(
                            (
                                await dispatch(
                                    "http://127.0.0.1:3120/api/inbox-notifications",
                                    {
                                        method: "POST",
                                        headers: {
                                            ...auth,
                                            origin: "https://foreign.example.test",
                                        },
                                        body: JSON.stringify({
                                            action: "read",
                                            ids: [randomUUID()],
                                        }),
                                    },
                                )
                            ).status,
                            403,
                        );
                        await assert.rejects(
                            ops.operationsSettings(
                                otherActor,
                                channels.dh.id,
                                db,
                            ),
                            (e) => e.status === 404,
                        );
                        await db
                            .update(s.users)
                            .set({ isActive: 0 })
                            .where(eq(s.users.id, b.userId));
                        await assert.rejects(
                            ops.notificationsPage(b, {}, db),
                            (e) => e.status === 401,
                        );
                        await db
                            .update(s.users)
                            .set({ isActive: 1 })
                            .where(eq(s.users.id, b.userId));
                    },
                );
                await check(
                    "같은 시각 101개 알림 커서·표시된 항목만 읽음·새 알림 보존",
                    async () => {
                        const d = {
                            ...b,
                            userId: randomUUID(),
                            name: "페이지 QA",
                        };
                        await db.insert(s.users).values({
                            id: d.userId,
                            orgId: actor.orgId,
                            name: d.name,
                            email: "paging@example.test",
                            password: "fake",
                        });
                        await db.insert(s.organizationMembers).values({
                            organizationId: actor.orgId,
                            userId: d.userId,
                            role: "member",
                        });
                        await db.insert(s.customerWorkspaceAccess).values({ orgId: actor.orgId, workspaceId: 10, userId: d.userId, role: "viewer" });
                        const time = at(23, "09:00");
                        await db.insert(s.inboxNotifications).values(
                            Array.from({ length: 101 }, (_, i) => ({
                                orgId: actor.orgId,
                                channelId: channels.bo.id,
                                conversationId: boSession.id,
                                userId: d.userId,
                                type: "assigned",
                                eventKey: "qa-page-" + i,
                                preview: "가상 알림 " + i,
                                createdAt: time,
                            })),
                        );
                        const ids = [];
                        let cursor;
                        for (let i = 0; i < 3; i++) {
                            const p = await ops.notificationsPage(
                                d,
                                { channelId: channels.bo.id, before: cursor },
                                db,
                            );
                            ids.push(...p.rows.map((r) => r.id));
                            cursor = p.rows.at(-1)?.id;
                        }
                        assert.equal(ids.length, 101);
                        assert.equal(new Set(ids).size, 101);
                        await ops.readNotifications(
                            d,
                            { action: "read", ids: ids.slice(0, 50) },
                            channels.bo.id,
                            db,
                        );
                        assert.equal(
                            (
                                await ops.notificationsPage(
                                    d,
                                    { channelId: channels.bo.id },
                                    db,
                                )
                            ).unread,
                            51,
                        );
                        await assert.rejects(
                            ops.notificationsPage(
                                actor,
                                { before: ids[0] },
                                db,
                            ),
                            (e) => e.status === 404,
                        );
                    },
                );
                await check(
                    "응대 101건 커서·집계 전체 범위·범위 밖 위치와 기간 거절",
                    async () => {
                        const time = dt("2027-01-01T10:00:00+09:00");
                        for (let i = 0; i < 101; i++) {
                            const [m] = await db
                                .insert(s.inboxMessages)
                                .values({
                                    conversationId: session.id,
                                    clientId: randomUUID(),
                                    kind: "customer",
                                    authorName: "페이지 QA",
                                    body: "가상 성과 " + i,
                                    createdAt: time,
                                })
                                .returning();
                            await db.insert(s.inboxServiceCases).values({
                                orgId: actor.orgId,
                                channelId: channels.dh.id,
                                conversationId: session.id,
                                originConversationId: session.id,
                                openedMessageId: m.id,
                                startedAt: time,
                                policy: defaultPolicy(),
                                policyVersion: 0,
                                slaApplied: false,
                            });
                        }
                        const first = await query(channels.dh.id, "2027-01-01");
                        assert.equal(first.summary.started, 101);
                        assert.equal(first.rows.length, 100);
                        const second = await query(
                            channels.dh.id,
                            "2027-01-01",
                            undefined,
                            { before: first.rows.at(-1).id },
                        );
                        assert.equal(second.rows.length, 1);
                        assert.ok(
                            !first.rows.some((r) => r.id === second.rows[0].id),
                        );
                        await assert.rejects(
                            query(channels.bo.id, "2027-01-01", undefined, {
                                before: first.rows[0].id,
                            }),
                            (e) => e.status === 404,
                        );
                        await assert.rejects(
                            query(channels.dh.id, "2026-01-01", "2027-12-31"),
                        );
                    },
                );
                console.log(
                    `상담 운영 SQL/API QA ${checks}개 통과 · 실제 고객/외부 알림·운영 DB 접근 0건`,
                );
                if (extra) await extra({ ...ctx, operationsChecks: checks });
                else await pg.close();
            } catch (e) {
                throw e;
            }
        },
    );
}
if (require.main === module)
    runOperationsCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runOperationsCheck };
