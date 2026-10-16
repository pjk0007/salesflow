/* eslint-disable @typescript-eslint/no-require-imports -- 가상 직원 수용량·대기열·별도 loopback PostgreSQL 동시성 검사 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function scenario(ctx, real = false) {
    const { db, pg, actor, clients, channels, repo, dispatch } = ctx,
        s = require("../src/lib/db/schema.ts"),
        { eq, and, sql } = require("drizzle-orm");
    const {
            setCapacity,
            capacityPage,
        } = require("../src/lib/inbox-capacity/repository.ts"),
        {
            dispatchChannel,
            processRoutingQueue,
        } = require("../src/lib/inbox-capacity/dispatcher.ts"),
        { generateToken } = require("../src/lib/auth.ts");
    let checks = 0;
    const check = async (name, fn) => {
        await fn();
        console.log(`PASS CAPACITY ${real ? "PG" : "SQL"} ${++checks} ${name}`);
    };
    const people = {};
    for (const [key, w, role] of [
        ["a", 8, "agent"],
        ["b", 8, "agent"],
        ["viewer", 8, "viewer"],
        ["bo", 10, "agent"],
    ]) {
        const id = randomUUID();
        people[key] = {
            ...actor,
            userId: id,
            name: "가상 한도 " + key,
            role: "member",
        };
        await db.insert(s.users).values({
            id,
            orgId: actor.orgId,
            name: people[key].name,
            email: id + "@example.test",
            password: "fake-only",
        });
        await db.insert(s.organizationMembers).values({
            organizationId: actor.orgId,
            userId: id,
            role: "member",
        });
        await db
            .insert(s.customerWorkspaceAccess)
            .values({ orgId: actor.orgId, workspaceId: w, userId: id, role });
    }
    const teamA = await clients.dh.createInboxTeam({
            channelId: channels.dh.id,
            name: "가상 한도 팀A",
            autoAssign: true,
            memberIds: [people.a.userId],
        }),
        teamB = await clients.dh.createInboxTeam({
            channelId: channels.dh.id,
            name: "가상 한도 팀B",
            autoAssign: true,
            memberIds: [people.a.userId],
        });
    const chat = async (id) =>
        (await repo.conversationDetail(actor, id, db)).conversation;
    const patch = async (id, part) =>
        repo.patchConversation(
            actor,
            id,
            { version: (await chat(id)).version, ...part },
            db,
        );
    const visitor = async (channel = channels.dh) => {
        const v = await repo.startVisitorSession(
            channel.publicKey,
            { name: "가상 한도 문의" },
            db,
        );
        await repo.sendVisitorMessage(
            channel.publicKey,
            v.token,
            { clientId: randomUUID(), body: "가상 한도 상담" },
            db,
        );
        return v;
    };
    const limit = async (who, max, channel = channels.dh) => {
        const d = await capacityPage(actor, channel.id, db),
            a = d.agents.find((x) => x.id === who.userId);
        return setCapacity(
            actor,
            {
                channelId: channel.id,
                userId: who.userId,
                version: a.version,
                maxOpenConversations: max,
            },
            db,
        );
    };
    const own = async () =>
        (await capacityPage(actor, channels.dh.id, db)).agents.find(
            (a) => a.id === people.a.userId,
        );
    const call = async (who, method, input, status = 200, query = "") => {
        const r = await dispatch(
            "http://127.0.0.1:3120/api/inbox-capacity" + query,
            {
                method,
                headers: {
                    authorization:
                        "Bearer " +
                        generateToken({ ...who, email: "qa@example.test" }),
                    "content-type": "application/json",
                },
                ...(input ? { body: JSON.stringify(input) } : {}),
            },
        );
        assert.equal(r.status, status, await r.clone().text());
        return (await r.json()).data;
    };
    await check(
        "스키마·기본 무제한·사업/키/관리 권한과 직원 자신의 상태 보존",
        async () => {
            assert.equal((await own()).maxOpenConversations, null);
            await call(
                people.a,
                "GET",
                null,
                403,
                "?channelId=" + channels.dh.id,
            );
            await assert.rejects(
                () => clients.bo.inboxCapacity(channels.dh.id),
                (e) => e.status === 403,
            );
            await assert.rejects(
                () =>
                    clients.read.updateInboxCapacity({
                        channelId: channels.dh.id,
                        userId: people.a.userId,
                        version: 0,
                        maxOpenConversations: 1,
                    }),
                (e) => e.status === 403,
            );
            const saved = await limit(people.a, 1);
            assert.equal(saved.version, 1);
            assert.equal((await own()).state, "away");
            await call(
                actor,
                "PATCH",
                {
                    channelId: channels.dh.id,
                    userId: people.bo.userId,
                    version: 0,
                    maxOpenConversations: 1,
                },
                403,
            );
            await call(
                actor,
                "PATCH",
                {
                    channelId: channels.dh.id,
                    userId: people.viewer.userId,
                    version: 0,
                    maxOpenConversations: 1,
                },
                403,
            );
        },
    );
    await check("0/1/무제한 입력·버전 충돌·멱등·직원 이름 감사", async () => {
        const current = await own(),
            same = await limit(people.a, 1);
        assert.equal(same.version, current.version);
        await call(
            actor,
            "PATCH",
            {
                channelId: channels.dh.id,
                userId: people.a.userId,
                version: 0,
                maxOpenConversations: 2,
            },
            409,
        );
        for (const max of [-1, 1001, 1.5, "2"])
            await call(
                actor,
                "PATCH",
                {
                    channelId: channels.dh.id,
                    userId: people.a.userId,
                    version: current.version,
                    maxOpenConversations: max,
                },
                400,
            );
        const audits = await db
            .select()
            .from(s.inboxAuditEvents)
            .where(eq(s.inboxAuditEvents.action, "capacity.updated"));
        assert.ok(
            audits.some(
                (a) => a.changes.capacityAgent.afterLabel === people.a.name,
            ),
        );
    });
    let first, waiting;
    await check(
        "팀을 넘는 같은 직원 합산과 한도에 도달한 팀 대기열",
        async () => {
            first = await visitor();
            await patch(first.id, { teamId: teamA.id });
            assert.equal((await chat(first.id)).assigneeId, people.a.userId);
            for (const teamId of [teamB.id, teamA.id]) {
                await patch(first.id, { teamId });
                assert.equal(
                    (await chat(first.id)).assigneeId,
                    people.a.userId,
                );
                assert.equal((await own()).openConversations, 1);
            }
            waiting = await visitor();
            await patch(waiting.id, { teamId: teamB.id });
            assert.equal((await chat(waiting.id)).assigneeId, null);
            assert.equal((await own()).openConversations, 1);
        },
    );
    await check(
        "종료/보류는 슬롯 해제·대기 상담 재처리·이미 맡은 상담 보존",
        async () => {
            const before = await chat(waiting.id);
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                0,
            );
            assert.equal((await chat(waiting.id)).version, before.version);
            await patch(first.id, { status: "closed" });
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                1,
            );
            assert.equal((await chat(waiting.id)).assigneeId, people.a.userId);
            await patch(waiting.id, { status: "snoozed" });
            const v = await visitor();
            await patch(v.id, { teamId: teamA.id });
            assert.equal((await chat(v.id)).assigneeId, people.a.userId);
            assert.equal((await own()).openConversations, 1);
            await limit(people.a, 0);
            assert.equal((await chat(v.id)).assigneeId, people.a.userId);
            const blocked = await visitor();
            await patch(blocked.id, { teamId: teamA.id });
            assert.equal((await chat(blocked.id)).assigneeId, null);
        },
    );
    await check(
        "수동 배정 초과 허용·무제한 복구·응대 상태와 한도 CAS 충돌",
        async () => {
            const v = await visitor();
            await patch(v.id, {
                teamId: teamA.id,
                assigneeId: people.a.userId,
            });
            assert.equal((await chat(v.id)).assigneeId, people.a.userId);
            assert.ok((await own()).openConversations > 0);
            const before = await own();
            await require("../src/lib/inbox-presence/repository.ts").setAvailability(
                people.a,
                {
                    channelId: channels.dh.id,
                    state: "available",
                    version: before.version,
                },
                db,
            );
            await call(
                actor,
                "PATCH",
                {
                    channelId: channels.dh.id,
                    userId: people.a.userId,
                    version: before.version,
                    maxOpenConversations: null,
                },
                409,
            );
            await limit(people.a, null);
            const another = await visitor();
            await patch(another.id, { teamId: teamB.id });
            assert.equal((await chat(another.id)).assigneeId, people.a.userId);
        },
    );
    await check(
        "AI 지정 이관 직원도 한도 확인 후 다른 팀원 또는 대기열",
        async () => {
            await limit(people.a, 0);
            const auto = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 AI 한도",
                autoAssign: true,
                memberIds: [people.a.userId, people.b.userId],
            });
            const v = await visitor();
            await patch(v.id, { teamId: auto.id, assigneeId: null });
            await patch(v.id, { aiState: "auto" });
            const {
                handoffSupport,
            } = require("../src/lib/customer-ai/queue.ts");
            await handoffSupport(db, v.id, "가상 한도 AI 이관", {
                handoffAssigneeId: people.a.userId,
            });
            assert.equal((await chat(v.id)).assigneeId, people.b.userId);
        },
    );
    await check(
        "수동/보관 팀·개인 지정/종료/과거/병합 상담은 큐 처리에서 제외",
        async () => {
            const manual = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 수동 한도",
                memberIds: [people.b.userId],
            });
            const v = await visitor();
            await patch(v.id, { teamId: manual.id });
            const before = await chat(v.id);
            await dispatchChannel(actor, channels.dh.id, db);
            assert.deepEqual(await chat(v.id), before);
            const archived = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 보관 한도",
                autoAssign: true,
                memberIds: [people.b.userId],
            });
            const a = await visitor();
            await patch(a.id, { teamId: archived.id, assigneeId: null });
            await clients.dh.updateInboxTeam(archived.id, {
                version: archived.version,
                enabled: false,
            });
            await dispatchChannel(actor, channels.dh.id, db);
            assert.equal((await chat(a.id)).assigneeId, null);
            const excluded = [
                { id: randomUUID(), historyOnly: true },
                { id: randomUUID(), mergedIntoId: first.id },
            ];
            await db.insert(s.inboxConversations).values(
                excluded.map((x) => ({
                    ...x,
                    orgId: actor.orgId,
                    channelId: channels.dh.id,
                    teamId: teamB.id,
                    tokenHash: randomUUID().replaceAll("-", "").repeat(2),
                    name: "가상 제외 큐",
                })),
            );
            await dispatchChannel(actor, channels.dh.id, db);
            for (const x of excluded) {
                const [row] = await db
                    .select()
                    .from(s.inboxConversations)
                    .where(eq(s.inboxConversations.id, x.id));
                assert.equal(row.assigneeId, null);
                assert.equal(row.routingAttemptAt, null);
                assert.equal(row.version, 1);
            }
        },
    );
    await check("막힌 앞50건 뒤 다른 팀 상담도 다음 회차에 배정", async () => {
        // Earlier queue rows are marked attempted so this check controls the first unseen batch.
        await db
            .update(s.inboxConversations)
            .set({ routingAttemptAt: new Date() })
            .where(eq(s.inboxConversations.channelId, channels.dh.id));
        const batch = [];
        for (let i = 0; i < 51; i++)
            batch.push({
                id: randomUUID(),
                orgId: actor.orgId,
                channelId: channels.dh.id,
                teamId: teamA.id,
                tokenHash: randomUUID().replaceAll("-", "").repeat(2),
                name: "가상 막힌 큐 " + i,
            });
        await db.insert(s.inboxConversations).values(batch);
        const openTeam = await clients.dh.createInboxTeam({
            channelId: channels.dh.id,
            name: "가상 다음 큐",
            autoAssign: true,
            memberIds: [people.b.userId],
        });
        const nextId = randomUUID();
        await db.insert(s.inboxConversations).values({
            id: nextId,
            orgId: actor.orgId,
            channelId: channels.dh.id,
            teamId: openTeam.id,
            tokenHash: randomUUID().replaceAll("-", "").repeat(2),
            name: "가상 뒤쪽 큐",
            createdAt: new Date(Date.now() + 1000),
        });
        await dispatchChannel(actor, channels.dh.id, db);
        assert.equal((await chat(nextId)).assigneeId, null);
        await dispatchChannel(actor, channels.dh.id, db);
        assert.equal((await chat(nextId)).assigneeId, people.b.userId);
    });
    await check(
        "native/서비스 수동 재처리·기본 워커 꺼짐·백오랩 독립 한도",
        async () => {
            await call(
                people.a,
                "POST",
                { channelId: channels.dh.id, action: "dispatch" },
                403,
            );
            const data = await clients.dh.inboxCapacity(channels.dh.id);
            assert.equal(data.workerEnabled, false);
            await limit(people.bo, 0, channels.bo);
            const team = await clients.bo.createInboxTeam({
                channelId: channels.bo.id,
                name: "가상 백오랩 한도",
                autoAssign: true,
                memberIds: [people.bo.userId],
            });
            const v = await visitor(channels.bo);
            await patch(v.id, { teamId: team.id });
            assert.equal((await chat(v.id)).assigneeId, null);
            await limit(people.bo, 1, channels.bo);
            assert.ok(
                (await clients.bo.dispatchInbox(channels.bo.id)).assigned >= 1,
            );
            assert.equal((await chat(v.id)).assigneeId, people.bo.userId);
            await processRoutingQueue(db);
        },
    );
    await check(
        "감사 실패는 한도/버전 보존·대기열 배정 재시도는 중복 없음",
        async () => {
            const before = await own();
            await pg.exec(
                "ALTER TABLE inbox_audit_events ADD CONSTRAINT qa_capacity_audit_failure CHECK (action <> 'capacity.updated') NOT VALID",
            );
            try {
                await assert.rejects(() =>
                    setCapacity(
                        actor,
                        {
                            channelId: channels.dh.id,
                            userId: people.a.userId,
                            version: before.version,
                            maxOpenConversations: 3,
                        },
                        db,
                    ),
                );
            } finally {
                await pg.exec(
                    "ALTER TABLE inbox_audit_events DROP CONSTRAINT qa_capacity_audit_failure",
                );
            }
            assert.equal(
                (await own()).maxOpenConversations,
                before.maxOpenConversations,
            );
            assert.equal((await own()).version, before.version);
            const assigned = (
                await db
                    .select()
                    .from(s.inboxConversations)
                    .where(
                        and(
                            eq(s.inboxConversations.channelId, channels.dh.id),
                            eq(
                                s.inboxConversations.assigneeId,
                                people.b.userId,
                            ),
                        ),
                    )
            ).length;
            await dispatchChannel(actor, channels.dh.id, db);
            const again = (
                await db
                    .select()
                    .from(s.inboxConversations)
                    .where(
                        and(
                            eq(s.inboxConversations.channelId, channels.dh.id),
                            eq(
                                s.inboxConversations.assigneeId,
                                people.b.userId,
                            ),
                        ),
                    )
            ).length;
            assert.equal(again, assigned);
        },
    );
    if (real)
        await check(
            "독립 PostgreSQL 연결의 다른 팀 동시 선택·커밋 전 잠금·슬롯 해제 후 복구",
            async () => {
                // Isolate from the preceding scenarios without touching any real data.
                await db
                    .update(s.inboxConversations)
                    .set({ status: "closed" })
                    .where(eq(s.inboxConversations.channelId, channels.dh.id));
                await limit(people.a, 1);
                const a = await visitor(),
                    b = await visitor();
                let entered, release, rejectReady;
                const ready = new Promise((r, reject) => {
                        entered = r;
                        rejectReady = reject;
                    }),
                    gate = new Promise((r) => (release = r));
                let pidA;
                const jobA = db.transaction(async (tx) => {
                    [{ pid: pidA }] = await tx
                        .select({ pid: sql`pg_backend_pid()` })
                        .from(s.users)
                        .where(eq(s.users.id, actor.userId));
                    await repo.patchConversation(
                        actor,
                        a.id,
                        {
                            version: (await chat(a.id)).version,
                            teamId: teamA.id,
                        },
                        tx,
                    );
                    entered();
                    await gate;
                });
                jobA.catch(rejectReady);
                await ready;
                let timedOut = false;
                const jobB = db.transaction(async (tx) => {
                    const [pidB] = await tx
                        .select({ pid: sql`pg_backend_pid()` })
                        .from(s.users)
                        .where(eq(s.users.id, actor.userId));
                    assert.notEqual(pidB.pid, pidA);
                    return repo.patchConversation(
                        actor,
                        b.id,
                        {
                            version: (await chat(b.id)).version,
                            teamId: teamB.id,
                        },
                        tx,
                    );
                });
                const timeout = new Promise((_, reject) => {
                    const timer = setTimeout(() => {
                        timedOut = true;
                        reject(
                            new Error(
                                "busy limited agent blocked instead of queueing",
                            ),
                        );
                    }, 3000);
                    jobB.finally(() => clearTimeout(timer)).catch(() => {});
                });
                let result;
                try {
                    result = await Promise.race([jobB, timeout]);
                } finally {
                    release();
                    await jobA;
                }
                assert.equal(timedOut, false);
                assert.equal(result.assigneeId, null);
                assert.equal((await own()).openConversations, 1);
                await patch(a.id, { status: "closed" });
                assert.equal(
                    (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                    1,
                );
                assert.equal((await chat(b.id)).assigneeId, people.a.userId);
                assert.equal((await own()).openConversations, 1);
            },
        );
    if (real)
        await check(
            "서로 다른 여덟 팀 동시 요청은 한도2를 지키고 빈 슬롯만 재처리",
            async () => {
                await db
                    .update(s.inboxConversations)
                    .set({ status: "closed" })
                    .where(eq(s.inboxConversations.channelId, channels.dh.id));
                await limit(people.a, 2);
                const items = [];
                for (let i = 0; i < 8; i++)
                    items.push({
                        team: await clients.dh.createInboxTeam({
                            channelId: channels.dh.id,
                            name: "가상 동시 팀 " + i,
                            autoAssign: true,
                            memberIds: [people.a.userId],
                        }),
                        v: await visitor(),
                    });
                await Promise.all(
                    items.map((x) => patch(x.v.id, { teamId: x.team.id })),
                );
                assert.ok((await own()).openConversations <= 2);
                await dispatchChannel(actor, channels.dh.id, db);
                assert.equal((await own()).openConversations, 2);
                const active = [];
                for (const x of items)
                    if ((await chat(x.v.id)).assigneeId) active.push(x.v.id);
                await patch(active[0], { status: "closed" });
                await processRoutingQueue(db);
                assert.equal((await own()).openConversations, 2);
            },
        );
    if (real)
        await check(
            "실제 드라이버의 메시지 시간·접속 시각·응대 성과 날짜 필터",
            async () => {
                const report =
                    await require("../src/lib/inbox-operations/reports.ts").operationsReport(
                        actor,
                        channels.dh.id,
                        { from: "2026-10-01", to: "2026-10-31" },
                        db,
                    );
                assert.equal(typeof report.summary.started, "number");
                const {
                    presencePage,
                    setAvailability,
                    heartbeat,
                } = require("../src/lib/inbox-presence/repository.ts");
                const current = (
                    await presencePage(people.a, channels.dh.id, null, db)
                ).me;
                await setAvailability(
                    people.a,
                    {
                        channelId: channels.dh.id,
                        state: "available",
                        version: current.version,
                    },
                    db,
                );
                await heartbeat(
                    people.a,
                    {
                        channelId: channels.dh.id,
                        sessionId: randomUUID(),
                        sequence: 1,
                    },
                    db,
                );
                const team = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 실제 접속 시각",
                    autoAssign: true,
                    requireAvailable: true,
                    memberIds: [people.a.userId],
                });
                await limit(people.a, null);
                const v = await visitor();
                await patch(v.id, { teamId: team.id });
                assert.equal((await chat(v.id)).assigneeId, people.a.userId);
            },
        );
    await check(
        "자동화 모의 실행은 한도0에서 대기열을 표시하고 사람 게시 후 실제 한도를 재확인",
        async () => {
            await db
                .update(s.inboxConversations)
                .set({ status: "closed" })
                .where(eq(s.inboxConversations.channelId, channels.dh.id));
            await limit(people.a, 0);
            const team = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 자동화 수용량 재확인",
                autoAssign: true,
                memberIds: [people.a.userId],
            });
            const v = await visitor();
            const latestEvent = async () => {
                const events = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.type, "message.created"),
                            eq(
                                s.platformEvents.workspaceId,
                                channels.dh.workspaceId,
                            ),
                        ),
                    )
                    .orderBy(sql`${s.platformEvents.sequence} DESC`);
                const event = events.find(
                    (e) => e.payload.data.conversationId === v.id,
                );
                assert.ok(event);
                return event;
            };
            const {
                emptyGroup,
            } = require("../src/lib/customer-workflows/rules.ts");
            const wf = await clients.dh.saveWorkflow({
                workspaceId: channels.dh.workspaceId,
                version: 0,
                name: "가상 자동화 수용량 QA",
                description: "",
                definition: {
                    trigger: {
                        types: ["message.created"],
                        eventName: "",
                        when: {
                            mode: "all",
                            rules: [
                                {
                                    path: "event.data.message.kind",
                                    op: "eq",
                                    value: "customer",
                                },
                            ],
                        },
                    },
                    steps: [
                        {
                            id: randomUUID(),
                            label: "팀 배정",
                            when: emptyGroup,
                            kind: "team",
                            teamId: team.id,
                            onlyUnassigned: true,
                        },
                    ],
                },
            });
            const preview = await clients.dh.previewWorkflow(
                wf.workflow.id,
                wf.revision.id,
                (await latestEvent()).id,
            );
            assert.ok(preview.passed, JSON.stringify(preview.report));
            assert.match(JSON.stringify(preview.report), /팀 대기열/);
            assert.equal((await chat(v.id)).teamId, null);
            await clients.dh.publishWorkflow(
                wf.workflow.id,
                wf.workflow.version,
                wf.revision.id,
                preview.id,
            );
            await limit(people.a, 1);
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                v.token,
                { clientId: randomUUID(), body: "가상 게시 후 실제 한도 확인" },
                db,
            );
            const event = await latestEvent();
            const [run] = await db
                .select()
                .from(s.customerWorkflowRuns)
                .where(
                    and(
                        eq(s.customerWorkflowRuns.workflowId, wf.workflow.id),
                        eq(s.customerWorkflowRuns.eventId, event.id),
                    ),
                );
            assert.ok(run);
            const {
                processWorkflowRun,
            } = require("../src/lib/customer-workflows/worker.ts");
            for (let i = 0; i < 4; i++) {
                await processWorkflowRun(run.id, {
                    exec: db,
                    now: () => new Date(Date.now() + 100000000),
                });
            }
            const [finished] = await db
                .select()
                .from(s.customerWorkflowRuns)
                .where(eq(s.customerWorkflowRuns.id, run.id));
            assert.equal(finished.state, "succeeded");
            assert.equal((await chat(v.id)).teamId, team.id);
            assert.equal((await chat(v.id)).assigneeId, people.a.userId);
            assert.equal((await own()).openConversations, 1);
        },
    );
    await check(
        "자동 재처리는 각 사업의 현재 관리자를 확인하고 열람 직원을 한도 편집에서 제외",
        async () => {
            assert.equal(
                (await capacityPage(actor, channels.dh.id, db)).agents.some(
                    (a) => a.id === people.viewer.userId,
                ),
                false,
            );
            await db
                .update(s.organizationMembers)
                .set({ role: "member" })
                .where(
                    and(
                        eq(s.organizationMembers.organizationId, actor.orgId),
                        eq(s.organizationMembers.userId, actor.userId),
                    ),
                );
            await db.insert(s.customerWorkspaceAccess).values({
                orgId: actor.orgId,
                userId: actor.userId,
                workspaceId: 8,
                role: "manager",
            });
            await db
                .update(s.customerWorkspaceAccess)
                .set({ role: "manager" })
                .where(eq(s.customerWorkspaceAccess.userId, people.bo.userId));
            await db
                .update(s.inboxConversations)
                .set({ status: "closed" })
                .where(eq(s.inboxConversations.channelId, channels.bo.id));
            const [boTeam] = await db
                .select()
                .from(s.inboxTeams)
                .where(
                    and(
                        eq(s.inboxTeams.channelId, channels.bo.id),
                        eq(s.inboxTeams.name, "가상 백오랩 한도"),
                    ),
                );
            const v = await visitor(channels.bo);
            await db
                .update(s.inboxConversations)
                .set({ teamId: boTeam.id })
                .where(eq(s.inboxConversations.id, v.id));
            await processRoutingQueue(db);
            const [assigned] = await db
                .select()
                .from(s.inboxConversations)
                .where(eq(s.inboxConversations.id, v.id));
            assert.equal(assigned.assigneeId, people.bo.userId);
        },
    );
    console.log(
        `상담원 수용량 ${real ? "실제 격리 PostgreSQL" : "PGlite"} QA ${checks}개 통과 · 실제 고객/운영 DB/외부 발송 없음`,
    );
    await pg.close();
}
async function main() {
    if (!process.argv.includes("--postgres"))
        return runPlatformCheck((ctx) => scenario(ctx));
    await require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(
        (ctx) => scenario(ctx, true),
    );
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
