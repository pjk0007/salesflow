/* eslint-disable @typescript-eslint/no-require-imports -- 가상 문의·직원과 격리 PGlite의 조건별 상담팀 이관 검증 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function main() {
    await runPlatformCheck(
        async ({ db, pg, actor, repo, clients, channels, dispatch }) => {
            const s = require("../src/lib/db/schema.ts"),
                { eq, and, desc } = require("drizzle-orm"),
                {
                    emptyGroup,
                    definitionSchema,
                } = require("../src/lib/customer-workflows/rules.ts"),
                {
                    executeWorkflowAction,
                } = require("../src/lib/customer-workflows/actions.ts"),
                {
                    processWorkflowRun,
                } = require("../src/lib/customer-workflows/worker.ts"),
                { generateToken } = require("../src/lib/auth.ts");
            let checks = 0;
            const check = async (name, fn) => {
                await fn();
                console.log(`PASS FLOW ROUTING ${++checks} ${name}`);
            };
            const node = (kind, part = {}) => ({
                id: randomUUID(),
                label: kind,
                when: emptyGroup,
                kind,
                ...part,
            });
            const condition = (path, op, value) => ({
                mode: "all",
                rules: [{ path, op, value }],
            });
            const people = [randomUUID(), randomUUID()];
            for (const [i, id] of people.entries()) {
                await db
                    .insert(s.users)
                    .values({
                        id,
                        orgId: actor.orgId,
                        name: `가상 분류 담당 ${i + 1}`,
                        email: id + "@example.test",
                        password: "fake-only",
                    });
                await db
                    .insert(s.organizationMembers)
                    .values({
                        userId: id,
                        organizationId: actor.orgId,
                        role: "member",
                    });
                await db
                    .insert(s.customerWorkspaceAccess)
                    .values({
                        userId: id,
                        orgId: actor.orgId,
                        workspaceId: 8,
                        role: "agent",
                    });
            }
            const manual = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 디자인 상담",
                memberIds: [people[0]],
            });
            const automatic = await clients.dh.createInboxTeam({
                channelId: channels.dh.id,
                name: "가상 디자인 전문팀",
                memberIds: people,
                autoAssign: true,
            });
            const bo = await clients.bo.createInboxTeam({
                channelId: channels.bo.id,
                name: "가상 디자인 상담",
                memberIds: [actor.userId],
                autoAssign: true,
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
            const send = async (
                visitor,
                channel = channels.dh,
                body = "디자인 도입 문의",
            ) => {
                await repo.sendVisitorMessage(
                    channel.publicKey,
                    visitor.token,
                    { clientId: randomUUID(), body },
                    db,
                );
                const events = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.type, "message.created"),
                            eq(
                                s.platformEvents.workspaceId,
                                channel.workspaceId,
                            ),
                        ),
                    )
                    .orderBy(desc(s.platformEvents.sequence));
                return events.find(
                    (e) => e.payload.data.conversationId === visitor.id,
                );
            };
            const visitor = async (channel = channels.dh) => {
                const v = await repo.startVisitorSession(
                    channel.publicKey,
                    { name: "가상 팀 분류 고객" },
                    db,
                );
                await send(v, channel);
                return v;
            };
            const definition = (steps) => ({
                trigger: {
                    types: ["message.created"],
                    eventName: "",
                    when: condition(
                        "event.data.message.kind",
                        "eq",
                        "customer",
                    ),
                },
                steps,
            });
            const save = (steps, client = clients.dh, workspaceId = 8) =>
                client.saveWorkflow({
                    workspaceId,
                    version: 0,
                    name: "가상 조건별 팀 QA " + randomUUID(),
                    description: "",
                    definition: definition(steps),
                });
            const source = await visitor(),
                sourceEvent = await send(source);
            async function preview(
                wf,
                client = clients.dh,
                event = sourceEvent,
            ) {
                return client.previewWorkflow(
                    wf.workflow.id,
                    wf.revision.id,
                    event.id,
                );
            }
            async function publish(
                wf,
                client = clients.dh,
                event = sourceEvent,
            ) {
                const p = await preview(wf, client, event);
                assert.ok(p.passed, JSON.stringify(p.report));
                await client.publishWorkflow(
                    wf.workflow.id,
                    wf.workflow.version,
                    wf.revision.id,
                    p.id,
                );
                return p;
            }
            const run = async (wf, v, channel = channels.dh, body) => {
                const e = await send(v, channel, body);
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
                return r;
            };
            async function finish(r, options = {}) {
                for (let i = 0; i < 25; i++) {
                    await processWorkflowRun(r.id, {
                        exec: db,
                        now: () => new Date(Date.now() + 100000000),
                        ...options,
                    });
                    const [row] = await db
                        .select()
                        .from(s.customerWorkflowRuns)
                        .where(eq(s.customerWorkflowRuns.id, r.id));
                    if (
                        [
                            "failed",
                            "succeeded",
                            "skipped",
                            "cancelled",
                        ].includes(row.state)
                    )
                        return row;
                }
                throw new Error("가상 팀 자동화가 완료되지 않았습니다.");
            }
            const results = (r) =>
                db
                    .select()
                    .from(s.customerWorkflowSteps)
                    .where(eq(s.customerWorkflowSteps.runId, r.id))
                    .orderBy(s.customerWorkflowSteps.position);
            const route = (teamId, part = {}) =>
                node("team", { teamId, onlyUnassigned: true, ...part });
            await check(
                "단계 기본값·입력과 native/서비스 API 행동 목록",
                async () => {
                    const omitted = node("team", { teamId: manual.id });
                    assert.equal(
                        definitionSchema.parse(definition([omitted])).steps[0]
                            .onlyUnassigned,
                        true,
                    );
                    assert.equal(
                        definitionSchema.safeParse(definition([route("")]))
                            .success,
                        false,
                    );
                    assert.equal(
                        (await clients.dh.workflows(8)).stepNames.team,
                        "상담팀 배정",
                    );
                    const response = await dispatch(
                        "http://127.0.0.1:3120/api/customer-workflows?workspaceId=8",
                        {
                            headers: {
                                authorization:
                                    "Bearer " +
                                    generateToken({
                                        ...actor,
                                        email: "qa@example.test",
                                    }),
                            },
                        },
                    );
                    assert.equal(response.status, 200);
                    assert.equal(
                        (await response.json()).data.stepNames.team,
                        "상담팀 배정",
                    );
                },
            );
            await check(
                "사업이 다른 팀·없는 팀·읽기 키·보관 팀 참조 차단",
                async () => {
                    for (const id of [bo.id, randomUUID()])
                        await assert.rejects(
                            () => save([route(id)]),
                            (e) => e.status === 409,
                        );
                    await assert.rejects(
                        () => save([route(manual.id)], clients.read),
                        (e) => e.status === 403,
                    );
                    const archived = await clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "가상 보관 분류",
                        enabled: false,
                    });
                    await assert.rejects(
                        () => save([route(archived.id)]),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "자동 팀 모의 실행은 후보를 설명하고 배정·순서·이력을 변경하지 않음",
                async () => {
                    const wf = await save([route(automatic.id)]),
                        before = await chat(source.id),
                        members = await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, automatic.id)),
                        events = await db.select().from(s.platformEvents),
                        notes = await db.select().from(s.inboxNotifications);
                    const p = await preview(wf);
                    assert.ok(p.passed);
                    assert.match(
                        p.report.steps[0].detail,
                        /자동 배정 예상.*가상 분류 담당/,
                    );
                    assert.deepEqual(await chat(source.id), before);
                    assert.deepEqual(
                        await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, automatic.id)),
                        members,
                    );
                    assert.deepEqual(
                        await db.select().from(s.platformEvents),
                        events,
                    );
                    assert.deepEqual(
                        await db.select().from(s.inboxNotifications),
                        notes,
                    );
                },
            );
            await check(
                "문의 조건별 수동 팀 이관·다음 단계 최신 팀 조건·멱등 감사",
                async () => {
                    const wf = await save([
                        route(manual.id, {
                            when: condition(
                                "event.data.message.body",
                                "contains",
                                "디자인",
                            ),
                        }),
                        node("tag", {
                            tag: "팀 연결됨",
                            remove: false,
                            when: condition(
                                "conversation.teamId",
                                "eq",
                                manual.id,
                            ),
                        }),
                    ]);
                    await publish(wf);
                    const v = await visitor(),
                        r = await run(wf, v);
                    assert.equal((await finish(r)).state, "succeeded");
                    let c = await chat(v.id);
                    assert.equal(c.teamId, manual.id);
                    assert.equal(c.assigneeId, null);
                    assert.ok(c.tags.includes("팀 연결됨"));
                    const before = await results(r);
                    await finish(r);
                    assert.deepEqual(await results(r), before);
                    assert.equal(before[0].detail.teamName, manual.name);
                    assert.equal(before[0].detail.assigneeName, null);
                    const other = await visitor(),
                        ignored = await run(
                            wf,
                            other,
                            channels.dh,
                            "경리 상담 문의",
                        );
                    await finish(ignored);
                    assert.equal((await chat(other.id)).teamId, null);
                },
            );
            await check(
                "실행 직전 개인 또는 다른 팀 배정이 생기면 기본 설정은 보존",
                async () => {
                    const wf = await save([route(manual.id)]);
                    await publish(wf);
                    for (const part of [
                        { assigneeId: people[1] },
                        { teamId: automatic.id },
                    ]) {
                        const v = await visitor(),
                            r = await run(wf, v);
                        await patch(v.id, part);
                        const before = await chat(v.id);
                        await finish(r);
                        assert.deepEqual(await chat(v.id), before);
                        assert.match(
                            (await results(r))[0].detail.reason,
                            /기존 배정/,
                        );
                    }
                },
            );
            await check(
                "명시 교체는 개인을 해제하고 같은 팀 재실행은 기존 담당 유지",
                async () => {
                    const wf = await save([
                        route(manual.id, { onlyUnassigned: false }),
                    ]);
                    await publish(wf);
                    const v = await visitor();
                    await patch(v.id, { teamId: automatic.id });
                    const r = await run(wf, v);
                    await finish(r);
                    let c = await chat(v.id);
                    assert.equal(c.teamId, manual.id);
                    assert.equal(c.assigneeId, null);
                    await patch(v.id, { assigneeId: people[0] });
                    const again = await run(wf, v);
                    await finish(again);
                    c = await chat(v.id);
                    assert.equal(c.assigneeId, people[0]);
                    assert.equal(
                        (await results(again))[0].detail.assigneeName,
                        "가상 분류 담당 1",
                    );
                },
            );
            await check(
                "자동 팀 실제 배정은 부하를 나누고 결과에 실제 개인을 보존",
                async () => {
                    const balanced = await clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "가상 균등 QA",
                        memberIds: people,
                        autoAssign: true,
                    });
                    // 이 시나리오의 팀원 둘 모두 진행중 업무 0건에서 시작한다.
                    for (const id of people)
                        await db
                            .update(s.inboxConversations)
                            .set({ status: "closed" })
                            .where(eq(s.inboxConversations.assigneeId, id));
                    const wf = await save([route(balanced.id)]);
                    await publish(wf);
                    const assigned = [];
                    for (let i = 0; i < 2; i++) {
                        const v = await visitor(),
                            r = await run(wf, v);
                        assert.equal((await finish(r)).state, "succeeded");
                        const c = await chat(v.id);
                        assigned.push(c.assigneeId);
                        const [step] = await results(r);
                        assert.equal(step.detail.assigneeId, c.assigneeId);
                        assert.match(
                            step.detail.assigneeName,
                            /가상 분류 담당/,
                        );
                    }
                    assert.deepEqual(new Set(assigned), new Set(people));
                },
            );
            await check(
                "게시 후 팀 보관은 실패로 표시하고 상담·순서·결과를 그대로 보존",
                async () => {
                    let team = await clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "가상 게시후 보관",
                        autoAssign: true,
                        memberIds: people,
                    });
                    const wf = await save([route(team.id)]);
                    await publish(wf);
                    team = await clients.dh.updateInboxTeam(team.id, {
                        version: team.version,
                        enabled: false,
                    });
                    const v = await visitor(),
                        r = await run(wf, v),
                        before = await chat(v.id),
                        members = await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, team.id));
                    const failed = await finish(r);
                    assert.equal(failed.state, "failed");
                    assert.match(failed.reason, /상담팀/);
                    assert.deepEqual(await chat(v.id), before);
                    assert.equal((await results(r)).length, 0);
                    assert.deepEqual(
                        await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, team.id)),
                        members,
                    );
                },
            );
            await check(
                "모의 실행은 팀 뒤에 팀 밖 개인을 지정하는 불일치를 잡음",
                async () => {
                    const wf = await save([
                            route(manual.id),
                            node("assign", { assigneeId: people[1] }),
                        ]),
                        p = await preview(wf);
                    assert.equal(p.passed, false);
                    assert.equal(p.report.steps[1].status, "invalid");
                    assert.match(p.report.errors[0], /팀원/);
                    await assert.rejects(
                        () =>
                            clients.dh.publishWorkflow(
                                wf.workflow.id,
                                wf.workflow.version,
                                wf.revision.id,
                                p.id,
                            ),
                        (e) => e.status === 400,
                    );
                },
            );
            await check(
                "배정 변경과 단계 결과는 함께 롤백하고 수동 재시도에서 한 번만 처리",
                async () => {
                    const wf = await save([route(automatic.id)]);
                    await publish(wf);
                    const v = await visitor(),
                        r = await run(wf, v),
                        before = await chat(v.id),
                        members = await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, automatic.id));
                    const failed = await finish(r, {
                        perform: async (...args) => {
                            await executeWorkflowAction(...args);
                            throw new Error("가상 단계 결과 저장 장애");
                        },
                    });
                    assert.equal(failed.state, "failed");
                    assert.deepEqual(await chat(v.id), before);
                    assert.equal((await results(r)).length, 0);
                    assert.deepEqual(
                        await db
                            .select()
                            .from(s.inboxTeamMembers)
                            .where(eq(s.inboxTeamMembers.teamId, automatic.id)),
                        members,
                    );
                    await clients.dh.changeWorkflowRun(
                        wf.workflow.id,
                        r.id,
                        "retry",
                    );
                    assert.equal((await finish(r)).state, "succeeded");
                    assert.equal((await results(r)).length, 1);
                    await finish(r);
                    assert.equal((await results(r)).length, 1);
                },
            );
            await check(
                "대기 중 담당자 지정은 최신 정보로 보호하고 팀원 권한 회수는 빈 대기열로 처리",
                async () => {
                    const wf = await save([
                        node("wait", { minutes: 1 }),
                        route(manual.id),
                    ]);
                    await publish(wf);
                    const v = await visitor(),
                        r = await run(wf, v);
                    await processWorkflowRun(r.id, { exec: db });
                    await patch(v.id, { assigneeId: people[1] });
                    await finish(r);
                    assert.equal((await chat(v.id)).assigneeId, people[1]);
                    assert.match(
                        (await results(r))[1].detail.reason,
                        /기존 배정/,
                    );
                    const auto = await save([route(automatic.id)]);
                    await publish(auto);
                    for (const id of people)
                        await db
                            .update(s.customerWorkspaceAccess)
                            .set({ role: "viewer" })
                            .where(eq(s.customerWorkspaceAccess.userId, id));
                    const empty = await visitor(),
                        noAgent = await run(auto, empty);
                    assert.equal((await finish(noAgent)).state, "succeeded");
                    const c = await chat(empty.id);
                    assert.equal(c.teamId, automatic.id);
                    assert.equal(c.assigneeId, null);
                },
            );
            await check(
                "백오랩 동일 이름 팀 독립 실행과 디하 서비스 키의 결과 조회 경계",
                async () => {
                    const v = await visitor(channels.bo),
                        e = await send(v, channels.bo, "경리 서비스 도입 문의"),
                        wf = await save([route(bo.id)], clients.bo, 10);
                    await publish(wf, clients.bo, e);
                    const r = await run(
                        wf,
                        v,
                        channels.bo,
                        "경리 상담을 신청합니다",
                    );
                    assert.equal((await finish(r)).state, "succeeded");
                    const c = await chat(v.id);
                    assert.equal(c.teamId, bo.id);
                    assert.equal(c.assigneeId, actor.userId);
                    await assert.rejects(
                        () => clients.dh.workflowRun(wf.workflow.id, r.id),
                        (error) => [403, 404].includes(error.status),
                    );
                },
            );
            console.log(
                `조건별 상담팀 자동화 SQL/API QA: ${checks}개 통과. 실제 고객·서버·외부 발송 0건.`,
            );
            await pg.close();
        },
    );
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
