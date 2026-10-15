/* eslint-disable @typescript-eslint/no-require-imports -- 가상 사업 달력·직원·문의의 업무시간 배정 검수 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function scenario(ctx) {
    const { db, pg, actor, clients, channels, repo, dispatch } = ctx,
        s = require("../src/lib/db/schema.ts"),
        { eq, and, sql } = require("drizzle-orm"),
        { generateToken } = require("../src/lib/auth.ts"),
        { defaultPolicy } = require("../src/lib/inbox-operations/rules.ts"),
        { localDay } = require("../src/lib/inbox-operations/calendar.ts"),
        { teamAssignmentHours } = require("../src/lib/inbox-routing/hours.ts"),
        {
            dispatchChannel,
        } = require("../src/lib/inbox-capacity/dispatcher.ts");
    let count = 0;
    const check = async (name, fn) => {
        await fn();
        console.log(`PASS HOURS ${++count} ${name}`);
    };
    const staff = {
        ...actor,
        userId: randomUUID(),
        name: "가상 업무시간 담당",
        role: "member",
    };
    await db
        .insert(s.users)
        .values({
            id: staff.userId,
            orgId: actor.orgId,
            name: staff.name,
            email: staff.userId + "@example.test",
            password: "fake-only",
        });
    await db
        .insert(s.organizationMembers)
        .values({
            organizationId: actor.orgId,
            userId: staff.userId,
            role: "member",
        });
    await db
        .insert(s.customerWorkspaceAccess)
        .values({
            orgId: actor.orgId,
            userId: staff.userId,
            workspaceId: 8,
            role: "agent",
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
            { name: "가상 업무시간 문의" },
            db,
        );
        await repo.sendVisitorMessage(
            channel.publicKey,
            v.token,
            { clientId: randomUUID(), body: "가상 업무시간 상담" },
            db,
        );
        return v;
    };
    const team = async (id) =>
        clients.dh
            .inboxTeams(channels.dh.id)
            .then((rows) => rows.find((t) => t.id === id));
    const native = async (who, path, input, method = "POST", status = 200) => {
        const r = await dispatch("http://127.0.0.1:3120" + path, {
            method,
            headers: {
                authorization:
                    "Bearer " +
                    generateToken({ ...who, email: "qa@example.test" }),
                "content-type": "application/json",
            },
            ...(input ? { body: JSON.stringify(input) } : {}),
        });
        assert.equal(r.status, status, await r.clone().text());
        return (await r.json()).data;
    };
    const openCalendar = () => defaultPolicy().calendar;
    const closedCalendar = () => {
        const today = localDay(new Date(), "Asia/Seoul"),
            day = new Date(today + "T00:00:00Z").getUTCDay();
        return {
            timezone: "Asia/Seoul",
            weekly: [{ day: (day + 1) % 7, start: "09:00", end: "18:00" }],
            holidays: [],
        };
    };
    const calendar = async (
        value,
        channel = channels.dh,
        client = clients.dh,
    ) => {
        const current = await client.supportSettings(channel.id);
        return client.saveSupportSettings(channel.id, current.version, {
            ...defaultPolicy(),
            enabled: false,
            showHours: false,
            calendar: value,
        });
    };
    const reset = () =>
        db
            .update(s.inboxConversations)
            .set({ status: "closed" })
            .where(eq(s.inboxConversations.channelId, channels.dh.id));
    let basic, restricted, waiting;
    await check(
        "기본 꺼짐·기존 API 호환·명시 업무시간 미설정은 저장 거절",
        async () => {
            basic = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 제한 없는 팀",
                autoAssign: true,
                memberIds: [staff.userId],
            });
            assert.equal(basic.requireBusinessHours, false);
            assert.equal(basic.businessHours, null);
            await assert.rejects(
                () =>
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "가상 미설정 팀",
                        autoAssign: true,
                        requireBusinessHours: true,
                    }),
                (e) => e.status === 409 && /업무시간/.test(e.message),
            );
            await assert.rejects(
                () =>
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "가상 잘못된 설정",
                        requireBusinessHours: "true",
                    }),
                (e) => e.status === 400,
            );
            const v = await visitor();
            await patch(v.id, { teamId: basic.id });
            assert.equal((await chat(v.id)).assigneeId, staff.userId);
        },
    );
    await check(
        "새 옵션의 native/서비스 키·일반 직원 관리 권한 경계",
        async () => {
            await native(
                staff,
                "/api/inbox-routing/teams/" + basic.id,
                { version: basic.version, requireBusinessHours: true },
                "PATCH",
                403,
            );
            await assert.rejects(
                () =>
                    clients.read.updateInboxTeam(basic.id, {
                        version: basic.version,
                        requireBusinessHours: true,
                    }),
                (e) => e.status === 403,
            );
            await assert.rejects(
                () =>
                    clients.bo.updateInboxTeam(basic.id, {
                        version: basic.version,
                        requireBusinessHours: true,
                    }),
                (e) => e.status === 403,
            );
        },
    );
    await check(
        "저장한 사업 달력·시간대·다음 업무 시작·CAS/멱등·한글 감사",
        async () => {
            await calendar(closedCalendar());
            restricted = await native(actor, "/api/inbox-routing/teams", {
                channelId: channels.dh.id,
                name: "가상 업무시간 팀",
                autoAssign: true,
                requireBusinessHours: true,
                memberIds: [staff.userId],
            });
            assert.equal(restricted.businessHours.configured, true);
            assert.equal(restricted.businessHours.open, false);
            assert.equal(restricted.businessHours.timezone, "Asia/Seoul");
            assert.ok(restricted.businessHours.nextOpenAt);
            const same = await clients.dh.updateInboxTeam(restricted.id, {
                version: restricted.version,
                requireBusinessHours: true,
            });
            assert.equal(same.version, restricted.version);
            const next = await clients.dh.updateInboxTeam(restricted.id, {
                version: restricted.version,
                description: "가상 업무시간 검수",
            });
            await assert.rejects(
                () =>
                    clients.dh.updateInboxTeam(restricted.id, {
                        version: restricted.version,
                        requireBusinessHours: false,
                    }),
                (e) => e.status === 409,
            );
            restricted = next;
            const audits = await db
                .select()
                .from(s.inboxAuditEvents)
                .where(eq(s.inboxAuditEvents.action, "team.updated"));
            assert.ok(
                audits.some(
                    (a) => a.changes.requireBusinessHours?.after === true,
                ),
            );
        },
    );
    await check(
        "업무시간 밖은 팀 이관·수동 큐 재처리에서도 미배정",
        async () => {
            await reset();
            waiting = await visitor();
            await patch(waiting.id, { teamId: restricted.id });
            assert.equal((await chat(waiting.id)).assigneeId, null);
            const before = (await chat(waiting.id)).version;
            const result = await clients.dh.dispatchInbox(channels.dh.id);
            assert.equal(result.assigned, 0);
            assert.equal(result.waiting, 1);
            assert.equal((await chat(waiting.id)).version, before);
        },
    );
    await check(
        "업무가 시작되면 대기 상담 배정·기존 담당 보존·중복 없음",
        async () => {
            await calendar(openCalendar());
            assert.equal((await team(restricted.id)).businessHours.open, true);
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                1,
            );
            assert.equal((await chat(waiting.id)).assigneeId, staff.userId);
            await calendar(closedCalendar());
            assert.equal((await chat(waiting.id)).assigneeId, staff.userId);
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                0,
            );
        },
    );
    await check(
        "업무시간 밖 직접 담당 지정·옵션 꺼짐·수동팀 보존",
        async () => {
            const manual = await visitor();
            await patch(manual.id, {
                teamId: restricted.id,
                assigneeId: staff.userId,
            });
            assert.equal((await chat(manual.id)).assigneeId, staff.userId);
            const bypass = await visitor();
            await patch(bypass.id, { teamId: basic.id });
            assert.equal((await chat(bypass.id)).assigneeId, staff.userId);
            const saved = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 시간표 수동 팀",
                requireBusinessHours: true,
                memberIds: [staff.userId],
            });
            const v = await visitor();
            await patch(v.id, { teamId: saved.id });
            await calendar(openCalendar());
            await dispatchChannel(actor, channels.dh.id, db);
            assert.equal((await chat(v.id)).assigneeId, null);
        },
    );
    await check("휴무일과 SLA/고객 안내 꺼짐은 서로 다른 조건", async () => {
        const value = openCalendar();
        value.holidays = [localDay(new Date(), value.timezone)];
        await calendar(value);
        const view = await team(restricted.id);
        assert.equal(view.businessHours.open, false);
        const v = await visitor();
        await patch(v.id, { teamId: restricted.id });
        assert.equal((await chat(v.id)).assigneeId, null);
        const setting = await clients.dh.supportSettings(channels.dh.id);
        assert.equal(setting.policy.enabled, false);
        assert.equal(setting.policy.showHours, false);
    });
    await check(
        "업무 시작/끝·점심 구간·현지 휴무일·DST의 실제 저장 달력 재사용",
        async () => {
            await calendar({
                timezone: "America/New_York",
                weekly: [
                    { day: 1, start: "09:00", end: "12:00" },
                    { day: 1, start: "13:00", end: "18:00" },
                ],
                holidays: ["2026-10-19"],
            });
            const row = (
                await db
                    .select()
                    .from(s.inboxTeams)
                    .where(eq(s.inboxTeams.id, restricted.id))
            )[0];
            for (const [iso, open] of [
                ["2026-10-12T12:59:59Z", false],
                ["2026-10-12T13:00:00Z", true],
                ["2026-10-12T16:00:00Z", false],
                ["2026-10-12T17:00:00Z", true],
                ["2026-10-12T22:00:00Z", false],
                ["2026-10-19T14:00:00Z", false],
                ["2026-11-02T13:30:00Z", false],
                ["2026-11-02T14:00:00Z", true],
            ])
                assert.equal(
                    (await teamAssignmentHours(db, row, new Date(iso))).open,
                    open,
                    iso,
                );
            await calendar(openCalendar());
        },
    );
    await check(
        "활성 옵션에서 달력 누락은 기본 24시간 배정으로 바뀌지 않음",
        async () => {
            await db
                .delete(s.inboxOperationsSettings)
                .where(eq(s.inboxOperationsSettings.channelId, channels.dh.id));
            assert.equal(
                (await team(restricted.id)).businessHours.configured,
                false,
            );
            const v = await visitor();
            await patch(v.id, { teamId: restricted.id });
            assert.equal((await chat(v.id)).assigneeId, null);
            await calendar(openCalendar());
        },
    );
    await check(
        "업무시간·접속/응대 가능·수용량을 모두 만족해야 배정",
        async () => {
            await reset();
            const fresh = await team(restricted.id);
            await clients.dh.updateInboxTeam(restricted.id, {
                version: fresh.version,
                requireAvailable: true,
            });
            await clients.dh.updateInboxCapacity({
                channelId: channels.dh.id,
                userId: staff.userId,
                version: 0,
                maxOpenConversations: 0,
            });
            const v = await visitor();
            await patch(v.id, { teamId: restricted.id });
            assert.equal((await chat(v.id)).assigneeId, null);
            await clients.dh.updateInboxCapacity({
                channelId: channels.dh.id,
                userId: staff.userId,
                version: 1,
                maxOpenConversations: 1,
            });
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                0,
            );
            const {
                setAvailability,
                heartbeat,
            } = require("../src/lib/inbox-presence/repository.ts");
            await setAvailability(
                staff,
                { channelId: channels.dh.id, version: 2, state: "available" },
                db,
            );
            await heartbeat(
                staff,
                {
                    channelId: channels.dh.id,
                    sessionId: randomUUID(),
                    sequence: 1,
                },
                db,
            );
            assert.equal(
                (await dispatchChannel(actor, channels.dh.id, db)).assigned,
                1,
            );
            const full = await visitor();
            await patch(full.id, { teamId: restricted.id });
            assert.equal((await chat(full.id)).assigneeId, null);
            await clients.dh.updateInboxCapacity({
                channelId: channels.dh.id,
                userId: staff.userId,
                version: 3,
                maxOpenConversations: null,
            });
            await clients.dh.updateInboxTeam(restricted.id, {
                version: (await team(restricted.id)).version,
                requireAvailable: false,
            });
        },
    );
    await check(
        "AI의 지정 이관 직원도 업무시간을 확인·기존 개인 담당 유지",
        async () => {
            const {
                handoffSupport,
            } = require("../src/lib/customer-ai/queue.ts");
            await calendar(closedCalendar());
            const v = await visitor();
            await patch(v.id, { teamId: restricted.id });
            await patch(v.id, { aiState: "auto" });
            await handoffSupport(db, v.id, "가상 업무시간 AI 이관", {
                handoffAssigneeId: staff.userId,
            });
            assert.equal((await chat(v.id)).assigneeId, null);
            await calendar(openCalendar());
            const inside = await visitor();
            await patch(inside.id, { teamId: restricted.id, assigneeId: null });
            await patch(inside.id, { aiState: "auto" });
            await handoffSupport(db, inside.id, "가상 업무중 AI 이관", {
                handoffAssigneeId: staff.userId,
            });
            assert.equal((await chat(inside.id)).assigneeId, staff.userId);
            await calendar(closedCalendar());
            await patch(inside.id, { aiState: "auto" });
            await handoffSupport(db, inside.id, "가상 기존 담당 유지", {});
            assert.equal((await chat(inside.id)).assigneeId, staff.userId);
        },
    );
    await check(
        "자동화 모의 실행→사람 게시→실제 실행에서 최신 달력 재확인",
        async () => {
            const {
                    emptyGroup,
                } = require("../src/lib/customer-workflows/rules.ts"),
                {
                    processWorkflowRun,
                } = require("../src/lib/customer-workflows/worker.ts");
            const v = await visitor();
            const event = async () => {
                const rows = await db
                    .select()
                    .from(s.platformEvents)
                    .where(eq(s.platformEvents.type, "message.created"))
                    .orderBy(sql`${s.platformEvents.sequence} DESC`);
                return rows.find((e) => e.payload.data.conversationId === v.id);
            };
            const wf = await clients.dh.saveWorkflow({
                workspaceId: 8,
                version: 0,
                name: "가상 업무시간 자동화",
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
                            label: "팀",
                            kind: "team",
                            teamId: restricted.id,
                            onlyUnassigned: true,
                            when: emptyGroup,
                        },
                    ],
                },
            });
            const preview = await clients.dh.previewWorkflow(
                wf.workflow.id,
                wf.revision.id,
                (await event()).id,
            );
            assert.ok(preview.passed);
            assert.match(JSON.stringify(preview.report), /업무시간 밖/);
            assert.equal((await chat(v.id)).teamId, null);
            await clients.dh.publishWorkflow(
                wf.workflow.id,
                wf.workflow.version,
                wf.revision.id,
                preview.id,
            );
            const execute = async () => {
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    v.token,
                    { clientId: randomUUID(), body: "가상 최신 달력 실행" },
                    db,
                );
                const e = await event();
                const [r] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(
                        and(
                            eq(
                                s.customerWorkflowRuns.workflowId,
                                wf.workflow.id,
                            ),
                            eq(s.customerWorkflowRuns.eventId, e.id),
                        ),
                    );
                assert.ok(r);
                for (let i = 0; i < 4; i++)
                    await processWorkflowRun(r.id, {
                        exec: db,
                        now: () => new Date(Date.now() + 100000000),
                    });
            };
            await calendar(openCalendar());
            await execute();
            assert.equal((await chat(v.id)).assigneeId, staff.userId);
            await patch(v.id, { teamId: null, assigneeId: null });
            const openPreview = await clients.dh.previewWorkflow(
                wf.workflow.id,
                wf.revision.id,
                (await event()).id,
            );
            assert.match(JSON.stringify(openPreview.report), /자동 배정 예상/);
            await calendar(closedCalendar());
            await execute();
            assert.equal((await chat(v.id)).teamId, restricted.id);
            assert.equal((await chat(v.id)).assigneeId, null);
        },
    );
    await check(
        "백오랩 달력/팀 독립·디하 달력이 다른 사업 배정을 열지 않음",
        async () => {
            await calendar(openCalendar());
            await calendar(closedCalendar(), channels.bo, clients.bo);
            const bo = await clients.bo.createInboxTeam({
                channelId: channels.bo.id,
                name: "가상 업무시간 팀",
                autoAssign: true,
                requireBusinessHours: true,
                memberIds: [actor.userId],
            });
            assert.equal(bo.businessHours.open, false);
            assert.equal((await team(restricted.id)).businessHours.open, true);
            const v = await visitor(channels.bo);
            await patch(v.id, { teamId: bo.id });
            assert.equal((await chat(v.id)).assigneeId, null);
            assert.equal(
                (await clients.bo.dispatchInbox(channels.bo.id)).assigned,
                0,
            );
            await calendar(openCalendar(), channels.bo, clients.bo);
            assert.equal(
                (await clients.bo.dispatchInbox(channels.bo.id)).assigned,
                1,
            );
            assert.equal((await chat(v.id)).assigneeId, actor.userId);
        },
    );
    await check(
        "팀 감사 INSERT 실패는 시간 옵션/버전 변경도 함께 롤백",
        async () => {
            const before = await team(restricted.id);
            await pg.exec(
                "ALTER TABLE inbox_audit_events ADD CONSTRAINT qa_hours_failure CHECK (action <> 'team.updated') NOT VALID",
            );
            try {
                await assert.rejects(
                    () =>
                        clients.dh.updateInboxTeam(restricted.id, {
                            version: before.version,
                            requireBusinessHours: false,
                        }),
                    (e) => e.status === 500,
                );
            } finally {
                await pg.exec(
                    "ALTER TABLE inbox_audit_events DROP CONSTRAINT qa_hours_failure",
                );
            }
            const after = await team(restricted.id);
            assert.equal(after.version, before.version);
            assert.equal(after.requireBusinessHours, true);
        },
    );
    console.log(
        `업무시간 자동 배정 QA ${count}개 통과 · 가상 데이터/loopback 전용 · 실제 고객/운영 설정 변경 없음`,
    );
    await pg.close();
}
(process.argv.includes("--postgres")
    ? require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(
          scenario,
      )
    : runPlatformCheck(scenario)
).catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
