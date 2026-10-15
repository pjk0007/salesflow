/* eslint-disable @typescript-eslint/no-require-imports -- 가상 직원 접속·작성 표시와 격리 팀 배정 SQL/API 검증 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function main() {
    await runPlatformCheck(async (ctx) => {
        const { db, pg, actor, clients, channels, dispatch, repo } = ctx,
            s = require("../src/lib/db/schema.ts"),
            { eq } = require("drizzle-orm"),
            p = require("../src/lib/inbox-presence/repository.ts"),
            { generateToken } = require("../src/lib/auth.ts");
        const people = {};
        for (const [key, workspaceId, role] of [
            ["a", 8, "agent"],
            ["b", 8, "agent"],
            ["viewer", 8, "viewer"],
            ["bo", 10, "agent"],
        ]) {
            const userId = randomUUID();
            people[key] = {
                ...actor,
                userId,
                name: "가상 접속 " + key,
                role: "member",
            };
            await db.insert(s.users).values({
                id: userId,
                orgId: actor.orgId,
                name: people[key].name,
                email: userId + "@example.test",
                password: "fake-only",
            });
            await db.insert(s.organizationMembers).values({
                organizationId: actor.orgId,
                userId,
                role: "member",
            });
            await db
                .insert(s.customerWorkspaceAccess)
                .values({ orgId: actor.orgId, workspaceId, userId, role });
        }
        let checks = 0;
        const check = async (name, fn) => {
            await fn();
            console.log("PASS PRESENCE " + ++checks + " " + name);
        };
        const now = new Date();
        async function native(who, method, input, status = 200, query = "") {
            const r = await dispatch(
                "http://127.0.0.1:3120/api/inbox-presence" + query,
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
        }
        const beat = (sessionId, part = {}) => ({
            channelId: channels.dh.id,
            sessionId,
            sequence: 1,
            conversationId: null,
            activity: "viewing",
            ...part,
        });
        const status = async (who, state) =>
            p.setAvailability(
                who,
                {
                    channelId: channels.dh.id,
                    version: (
                        await p.presencePage(who, channels.dh.id, null, db)
                    ).me.version,
                    state,
                },
                db,
            );
        const visitor = async (channel = channels.dh) => {
            const v = await repo.startVisitorSession(
                channel.publicKey,
                { name: "가상 접속 배정 고객" },
                db,
            );
            await repo.sendVisitorMessage(
                channel.publicKey,
                v.token,
                { clientId: randomUUID(), body: "가상 접속 배정 문의" },
                db,
            );
            return v;
        };
        const first = await visitor(),
            foreign = await visitor(channels.bo);
        const page = (who = actor, at = now) =>
            p.presencePage(who, channels.dh.id, first.id, db, at);
        const snapshot = async (id) =>
            (await repo.conversationDetail(actor, id, db)).conversation;
        const move = async (v, team) =>
            repo.patchConversation(
                actor,
                v.id,
                { version: (await snapshot(v.id)).version, teamId: team.id },
                db,
            );
        await check(
            "마이그레이션/스키마 컬럼·팀 기본값·서비스 SDK 목록",
            async () => {
                const { getTableConfig } = require("drizzle-orm/pg-core");
                for (const table of [
                    s.inboxAgentAvailability,
                    s.inboxAgentSessions,
                ]) {
                    const c = getTableConfig(table),
                        rows = (
                            await pg.query(
                                "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                                [c.name],
                            )
                        ).rows;
                    assert.deepEqual(
                        rows.map((x) => x.column_name).sort(),
                        c.columns.map((x) => x.name).sort(),
                    );
                }
                const team = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 기본 접속 옵션",
                });
                assert.equal(team.requireAvailable, false);
                const data = await clients.dh.inboxPresence(channels.dh.id);
                assert.ok(data.agents.some((a) => a.id === people.a.userId));
                assert.equal(data.me.version, 0);
                await assert.rejects(
                    () => clients.bo.inboxPresence(channels.dh.id),
                    (e) => e.status === 403,
                );
            },
        );
        await check(
            "native 인증·직원 사업 경계·외부 키 쓰기 미제공·위조 필드 거절",
            async () => {
                const no = await dispatch(
                    "http://127.0.0.1:3120/api/inbox-presence?channelId=" +
                        channels.dh.id,
                    { method: "GET" },
                );
                assert.equal(no.status, 401);
                await native(
                    people.bo,
                    "GET",
                    null,
                    403,
                    "?channelId=" + channels.dh.id,
                );
                await native(
                    people.a,
                    "POST",
                    beat(randomUUID(), { userId: people.b.userId }),
                    400,
                );
                await native(
                    people.a,
                    "POST",
                    beat(randomUUID(), { expiresAt: "2099-01-01" }),
                    400,
                );
                await native(
                    people.viewer,
                    "PATCH",
                    {
                        channelId: channels.dh.id,
                        state: "available",
                        version: 0,
                    },
                    403,
                );
                await native(
                    people.viewer,
                    "POST",
                    beat(randomUUID(), {
                        conversationId: first.id,
                        activity: "reply",
                    }),
                    403,
                );
                await native(
                    people.viewer,
                    "POST",
                    beat(randomUUID(), { conversationId: first.id }),
                    200,
                );
                const r = await dispatch(
                    "http://127.0.0.1:3120/api/v1/inbox/presence",
                    {
                        method: "POST",
                        headers: { authorization: "Bearer " + ctx.keys.dh },
                        body: JSON.stringify(beat(randomUUID())),
                    },
                );
                assert.equal(r.status, 405);
            },
        );
        await check(
            "같은 사업 상담만 조회/표시하고 메모 본문은 받지 않음",
            async () => {
                await native(
                    people.a,
                    "POST",
                    beat(randomUUID(), { conversationId: foreign.id }),
                    404,
                );
                await native(
                    people.a,
                    "GET",
                    null,
                    404,
                    "?channelId=" +
                        channels.dh.id +
                        "&conversationId=" +
                        foreign.id,
                );
                await native(
                    people.a,
                    "POST",
                    beat(randomUUID(), {
                        conversationId: first.id,
                        activity: "note",
                        body: "외부로 나가면 안 되는 초안",
                    }),
                    400,
                );
            },
        );
        await check(
            "응대 상태 기본 자리비움·개인별 CAS·동일 값 멱등·다른 직원 보존",
            async () => {
                assert.equal((await page(people.a)).me.state, "away");
                const saved = await status(people.a, "available");
                assert.equal(saved.version, 1);
                const same = await status(people.a, "available");
                assert.equal(same.version, 1);
                await native(
                    people.a,
                    "PATCH",
                    { channelId: channels.dh.id, state: "away", version: 0 },
                    409,
                );
                assert.equal((await page(people.b)).me.version, 0);
                await native(
                    people.a,
                    "PATCH",
                    {
                        channelId: channels.dh.id,
                        state: "away",
                        version: 1,
                        userId: people.b.userId,
                    },
                    400,
                );
            },
        );
        const sessionA = randomUUID(),
            sessionB = randomUUID();
        await check(
            "탭별 접속/작성·정확한 만료와 응답에 세션 번호/초안 없음",
            async () => {
                await p.heartbeat(
                    people.a,
                    beat(sessionA, {
                        conversationId: first.id,
                        activity: "reply",
                    }),
                    db,
                    now,
                );
                let data = await page(),
                    a = data.agents.find((a) => a.id === people.a.userId);
                assert.equal(a.online, true);
                assert.equal(a.activity, "reply");
                assert.equal(Object.hasOwn(a, "sessionId"), false);
                assert.equal(Object.hasOwn(a, "typingUntil"), false);
                a = (
                    await page(actor, new Date(now.getTime() + 12000))
                ).agents.find((a) => a.id === people.a.userId);
                assert.equal(a.activity, "viewing");
                assert.equal(a.online, true);
                a = (
                    await page(actor, new Date(now.getTime() + 90000))
                ).agents.find((a) => a.id === people.a.userId);
                assert.equal(a.online, false);
                assert.equal(a.activity, null);
            },
        );
        await check(
            "같은 직원의 두 탭은 하나로 표시·한 탭 종료 후 다른 탭 유지",
            async () => {
                await p.heartbeat(
                    people.a,
                    beat(sessionB, {
                        conversationId: first.id,
                        activity: "note",
                    }),
                    db,
                    now,
                );
                let data = await page();
                assert.equal(
                    data.agents.filter((a) => a.id === people.a.userId).length,
                    1,
                );
                assert.equal(
                    data.agents.find((a) => a.id === people.a.userId).activity,
                    "reply",
                );
                await p.heartbeat(
                    people.a,
                    beat(sessionA, { sequence: 2, leave: true }),
                    db,
                    now,
                );
                const a = (await page()).agents.find(
                    (a) => a.id === people.a.userId,
                );
                assert.equal(a.online, true);
                assert.equal(a.activity, "note");
            },
        );
        await check(
            "지연·중복 갱신은 종료/새 상담/새 작성 상태를 덮지 않음",
            async () => {
                assert.equal(
                    (
                        await p.heartbeat(
                            people.a,
                            beat(sessionA, {
                                conversationId: first.id,
                                activity: "reply",
                                sequence: 1,
                            }),
                            db,
                            now,
                        )
                    ).accepted,
                    false,
                );
                await p.heartbeat(
                    people.a,
                    beat(sessionB, {
                        sequence: 3,
                        conversationId: first.id,
                        activity: "viewing",
                    }),
                    db,
                    now,
                );
                assert.equal(
                    (
                        await p.heartbeat(
                            people.a,
                            beat(sessionB, {
                                sequence: 2,
                                conversationId: first.id,
                                activity: "reply",
                            }),
                            db,
                            now,
                        )
                    ).accepted,
                    false,
                );
                assert.equal(
                    (await page()).agents.find((a) => a.id === people.a.userId)
                        .activity,
                    "viewing",
                );
                await p.heartbeat(
                    people.a,
                    beat(sessionB, { sequence: 4, leave: true }),
                    db,
                    now,
                );
                assert.equal(
                    (await page()).agents.find((a) => a.id === people.a.userId)
                        .online,
                    false,
                );
            },
        );
        await check(
            "접속만 하거나 상태만 가능이면 자동 배정 후보가 되지 않음",
            async () => {
                const team = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 준비된 직원만",
                    autoAssign: true,
                    requireAvailable: true,
                    memberIds: [people.a.userId, people.b.userId],
                });
                const v = await visitor();
                assert.equal((await move(v, team)).assigneeId, null);
                await p.heartbeat(people.b, beat(randomUUID()), db);
                const next = await visitor();
                assert.equal((await move(next, team)).assigneeId, null);
            },
        );
        let readyTeam;
        await check(
            "접속+응대 가능 현재 팀원만 선택·자리비움은 제외·권한 우선",
            async () => {
                readyTeam = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 접속 분류",
                    autoAssign: true,
                    requireAvailable: true,
                    memberIds: [people.a.userId, people.b.userId],
                });
                await p.heartbeat(people.a, beat(randomUUID()), db);
                await status(people.b, "away");
                let v = await visitor();
                assert.equal(
                    (await move(v, readyTeam)).assigneeId,
                    people.a.userId,
                );
                await status(people.a, "away");
                await status(people.b, "available");
                v = await visitor();
                assert.equal(
                    (await move(v, readyTeam)).assigneeId,
                    people.b.userId,
                );
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "viewer" })
                    .where(
                        eq(s.customerWorkspaceAccess.userId, people.b.userId),
                    );
                v = await visitor();
                assert.equal((await move(v, readyTeam)).assigneeId, null);
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "agent" })
                    .where(
                        eq(s.customerWorkspaceAccess.userId, people.b.userId),
                    );
            },
        );
        await check(
            "기존 접속 옵션 꺼짐 팀은 기존 후보 계약과 수동 배정을 유지",
            async () => {
                const team = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 기존 배정",
                    autoAssign: true,
                    memberIds: [people.a.userId],
                });
                await status(people.a, "away");
                const v = await visitor();
                assert.equal((await move(v, team)).assigneeId, people.a.userId);
                const manual = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 수동 접속",
                    memberIds: [people.a.userId],
                    requireAvailable: true,
                });
                const m = await visitor();
                assert.equal((await move(m, manual)).assigneeId, null);
                assert.equal(
                    (
                        await repo.patchConversation(
                            actor,
                            m.id,
                            {
                                version: (await snapshot(m.id)).version,
                                assigneeId: people.a.userId,
                            },
                            db,
                        )
                    ).assigneeId,
                    people.a.userId,
                );
            },
        );
        await check(
            "역할 회수/접근 제거는 즉시 작성 표시/목록/새 갱신에서 반영",
            async () => {
                const id = randomUUID();
                await p.heartbeat(
                    people.b,
                    beat(id, { conversationId: first.id, activity: "reply" }),
                    db,
                    now,
                );
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "viewer" })
                    .where(
                        eq(s.customerWorkspaceAccess.userId, people.b.userId),
                    );
                assert.equal(
                    (await page()).agents.find((a) => a.id === people.b.userId)
                        .activity,
                    "viewing",
                );
                await native(
                    people.b,
                    "POST",
                    beat(id, {
                        sequence: 2,
                        conversationId: first.id,
                        activity: "reply",
                    }),
                    403,
                );
                await db
                    .delete(s.customerWorkspaceAccess)
                    .where(
                        eq(s.customerWorkspaceAccess.userId, people.b.userId),
                    );
                assert.equal(
                    (await page()).agents.some((a) => a.id === people.b.userId),
                    false,
                );
                await native(people.b, "POST", beat(id, { sequence: 3 }), 403);
            },
        );
        await check(
            "만료된 자기 세션만 정리·타 직원 세션과 최근 종료 순서 보존·트랜잭션 롤백",
            async () => {
                const old = randomUUID(),
                    other = randomUUID();
                const past = new Date(now.getTime() - 2 * 86400000);
                await p.heartbeat(people.a, beat(old), db, past);
                await p.heartbeat(people.viewer, beat(other), db, past);
                await p.heartbeat(people.a, beat(randomUUID()), db, now);
                const list = await db.select().from(s.inboxAgentSessions);
                assert.equal(
                    list.some((r) => r.sessionId === old),
                    false,
                );
                assert.ok(list.some((r) => r.sessionId === other));
                assert.ok(list.some((r) => r.sessionId === sessionA));
                const rolled = randomUUID();
                await assert.rejects(() =>
                    db.transaction(async (tx) => {
                        await p.heartbeat(people.a, beat(rolled), tx, now);
                        throw new Error("가상 롤백");
                    }),
                );
                assert.equal(
                    (
                        await db
                            .select()
                            .from(s.inboxAgentSessions)
                            .where(eq(s.inboxAgentSessions.sessionId, rolled))
                    ).length,
                    0,
                );
            },
        );
        await check(
            "백오랩 사업별 독립 응대 상태·같은 UUID 세션은 직원별 분리",
            async () => {
                const id = randomUUID();
                await p.heartbeat(people.a, beat(id), db, now);
                await p.heartbeat(people.viewer, beat(id), db, now);
                assert.equal(
                    (
                        await db
                            .select()
                            .from(s.inboxAgentSessions)
                            .where(eq(s.inboxAgentSessions.sessionId, id))
                    ).length,
                    2,
                );
                await p.setAvailability(
                    people.bo,
                    {
                        channelId: channels.bo.id,
                        state: "available",
                        version: 0,
                    },
                    db,
                );
                await p.heartbeat(
                    people.bo,
                    {
                        ...beat(randomUUID()),
                        channelId: channels.bo.id,
                        conversationId: foreign.id,
                        activity: "note",
                    },
                    db,
                    now,
                );
                const bo = await clients.bo.inboxPresence(
                    channels.bo.id,
                    foreign.id,
                );
                assert.ok(
                    bo.agents.find(
                        (a) =>
                            a.id === people.bo.userId && a.activity === "note",
                    ),
                );
                assert.equal(
                    bo.agents.some((a) => a.id === people.a.userId),
                    false,
                );
            },
        );
        await check(
            "자동화 모의 실행과 실제 처리 사이 응대 상태 변경을 다시 확인",
            async () => {
                const { desc } = require("drizzle-orm"),
                    {
                        processWorkflowRun,
                    } = require("../src/lib/customer-workflows/worker.ts"),
                    {
                        emptyGroup,
                    } = require("../src/lib/customer-workflows/rules.ts");
                await status(people.a, "available");
                await p.heartbeat(people.a, beat(randomUUID()), db);
                const team = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "가상 접속 자동화",
                    memberIds: [people.a.userId],
                    autoAssign: true,
                    requireAvailable: true,
                });
                const events = await db
                    .select()
                    .from(s.platformEvents)
                    .where(eq(s.platformEvents.type, "message.created"))
                    .orderBy(desc(s.platformEvents.sequence));
                const source = events.find(
                    (e) => e.payload.data.conversationId === first.id,
                );
                const flow = await clients.dh.saveWorkflow({
                    workspaceId: 8,
                    version: 0,
                    name: "가상 접속 재평가",
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
                                label: "현재 가능한 팀원",
                                kind: "team",
                                teamId: team.id,
                                onlyUnassigned: true,
                                when: emptyGroup,
                            },
                        ],
                    },
                });
                const preview = await clients.dh.previewWorkflow(
                    flow.workflow.id,
                    flow.revision.id,
                    source.id,
                );
                assert.match(
                    preview.report.steps[0].detail,
                    /자동 배정 예상: 가상 접속 a/,
                );
                await clients.dh.publishWorkflow(
                    flow.workflow.id,
                    flow.workflow.version,
                    flow.revision.id,
                    preview.id,
                );
                await status(people.a, "away");
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    first.token,
                    {
                        clientId: randomUUID(),
                        body: "가상 접속 자동화 재평가 문의",
                    },
                    db,
                );
                const [run] = await db
                    .select()
                    .from(s.customerWorkflowRuns)
                    .where(
                        eq(s.customerWorkflowRuns.workflowId, flow.workflow.id),
                    );
                assert.ok(run);
                await processWorkflowRun(run.id, { exec: db });
                await processWorkflowRun(run.id, { exec: db });
                const c = await snapshot(first.id);
                assert.equal(c.teamId, team.id);
                assert.equal(c.assigneeId, null);
                const [result] = await db
                    .select()
                    .from(s.customerWorkflowSteps)
                    .where(eq(s.customerWorkflowSteps.runId, run.id));
                assert.equal(result.detail.teamId, team.id);
                assert.equal(result.detail.assigneeId, null);
            },
        );
        console.log(
            `상담원 접속/작성/배정 SQL/API QA: ${checks}개 통과. 실제 고객·DB·외부 발송 없음.`,
        );
        await pg.close();
    });
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
