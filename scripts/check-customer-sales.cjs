/* eslint-disable @typescript-eslint/no-require-imports -- 실제 전송 없는 격리 영업 API/SQL 검사 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
async function runSalesCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const { clients, db, pg, actor, otherActor, contacts } = ctx,
                schema = require("../src/lib/db/schema.ts");
            const request = (
                kind,
                method = "GET",
                body,
                id,
                ws = 8,
                client = clients.dh,
                query = "",
            ) =>
                client.request(
                    `/api/v1/crm/${kind}${id ? "/" + id : ""}${method === "GET" ? "?workspaceId=" + ws + query : ""}`,
                    method,
                    method === "GET" ? undefined : body,
                );
            let checks = 0;
            async function check(name, fn) {
                await fn();
                console.log(`PASS SALES ${++checks} ${name}`);
            }
            try {
                const stages = [
                    { id: randomUUID(), name: "문의접수", category: "open" },
                    { id: randomUUID(), name: "제안중", category: "open" },
                    { id: randomUUID(), name: "계약완료", category: "won" },
                    { id: randomUUID(), name: "보류·실패", category: "lost" },
                ];
                const pipeInput = {
                    workspaceId: 8,
                    externalId: "dh-main",
                    name: "디하 영업",
                    stages,
                };
                const pipeline = await request("pipelines", "POST", pipeInput);
                await check(
                    "파이프라인 생성 멱등·외부 번호 충돌·사업 API 범위",
                    async () => {
                        assert.equal(
                            (await request("pipelines", "POST", pipeInput)).id,
                            pipeline.id,
                        );
                        await assert.rejects(
                            request("pipelines", "POST", {
                                ...pipeInput,
                                name: "다른 내용",
                            }),
                            (e) => e.status === 409,
                        );
                        await assert.rejects(
                            request(
                                "pipelines",
                                "GET",
                                null,
                                null,
                                8,
                                clients.bo,
                            ),
                            (e) => e.status === 403,
                        );
                        await assert.rejects(
                            request(
                                "pipelines",
                                "POST",
                                pipeInput,
                                null,
                                8,
                                clients.read,
                            ),
                            (e) => e.status === 403,
                        );
                    },
                );
                const dealInput = {
                    workspaceId: 8,
                    externalId: "dh-deal-1",
                    title: "가상 디자인 구독 도입",
                    pipelineId: pipeline.id,
                    stageId: stages[0].id,
                    contactId: contacts.dh.id,
                    ownerId: actor.userId,
                    amount: "1500000",
                    currency: "KRW",
                    expectedCloseDate: "2026-11-01",
                    notes: "가상 영업 메모",
                };
                let deal = await request("deals", "POST", dealInput);
                await check(
                    "고객과 딜 연결·금액 정규화·중복 생성 시 이력 중복 없음",
                    async () => {
                        assert.equal(deal.amount, "1500000.00");
                        assert.equal(deal.contactId, contacts.dh.id);
                        assert.equal(
                            (await request("deals", "POST", dealInput)).id,
                            deal.id,
                        );
                        assert.equal(
                            (await request("deals", "GET", null, deal.id))
                                .history.length,
                            1,
                        );
                    },
                );
                await check(
                    "타 사업 고객·파이프라인·유효하지 않은 단계·외부 담당자 차단",
                    async () => {
                        await assert.rejects(
                            request("deals", "POST", {
                                ...dealInput,
                                externalId: "bad-contact",
                                contactId: contacts.bo.id,
                            }),
                            (e) => e.status === 400,
                        );
                        await assert.rejects(
                            request(
                                "deals",
                                "POST",
                                {
                                    ...dealInput,
                                    workspaceId: 10,
                                    externalId: "bad-pipe",
                                    contactId: null,
                                    ownerId: null,
                                },
                                null,
                                10,
                                clients.bo,
                            ),
                            (e) => e.status === 400,
                        );
                        await assert.rejects(
                            request("deals", "POST", {
                                ...dealInput,
                                externalId: "bad-stage",
                                stageId: randomUUID(),
                            }),
                            (e) => e.status === 400,
                        );
                        await assert.rejects(
                            request("deals", "POST", {
                                ...dealInput,
                                externalId: "bad-owner",
                                ownerId: otherActor.userId,
                            }),
                            (e) => e.status === 400,
                        );
                    },
                );
                await check(
                    "딜 단계 변경과 담당자·전후 상태 감사 이력",
                    async () => {
                        deal = await request(
                            "deals",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: deal.version,
                                stageId: stages[1].id,
                            },
                            deal.id,
                        );
                        const detail = await request(
                            "deals",
                            "GET",
                            null,
                            deal.id,
                        );
                        assert.equal(
                            detail.history[0].change.before.stageId,
                            stages[0].id,
                        );
                        assert.equal(
                            detail.history[0].change.after.stageId,
                            stages[1].id,
                        );
                        assert.equal(detail.history[0].actorId, actor.userId);
                        assert.equal(
                            detail.history[0].change.stage.name,
                            "제안중",
                        );
                    },
                );
                await check(
                    "오래된 버전 수정은 충돌 · 타 사업 딜 조회는 없음",
                    async () => {
                        await assert.rejects(
                            request(
                                "deals",
                                "PATCH",
                                {
                                    workspaceId: 8,
                                    version: 1,
                                    title: "덮어쓰기",
                                },
                                deal.id,
                            ),
                            (e) => e.status === 409,
                        );
                        await assert.rejects(
                            request(
                                "deals",
                                "GET",
                                null,
                                deal.id,
                                10,
                                clients.bo,
                            ),
                            (e) => e.status === 404,
                        );
                    },
                );
                await check(
                    "사용 중인 단계 삭제 차단과 파이프라인 버전 검증",
                    async () => {
                        await assert.rejects(
                            request(
                                "pipelines",
                                "PATCH",
                                {
                                    workspaceId: 8,
                                    version: 1,
                                    stages: stages.filter(
                                        (s) => s.id !== stages[1].id,
                                    ),
                                },
                                pipeline.id,
                            ),
                            (e) => e.status === 409,
                        );
                        const next = await request(
                            "pipelines",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: 1,
                                name: "디하 도입 파이프라인",
                            },
                            pipeline.id,
                        );
                        assert.equal(next.version, 2);
                        await assert.rejects(
                            request(
                                "pipelines",
                                "PATCH",
                                {
                                    workspaceId: 8,
                                    version: 1,
                                    name: "오래된 수정",
                                },
                                pipeline.id,
                            ),
                            (e) => e.status === 409,
                        );
                    },
                );
                const taskInput = {
                    workspaceId: 8,
                    externalId: "followup-1",
                    title: "도입 일정 확인",
                    dealId: deal.id,
                    contactId: contacts.dh.id,
                    ownerId: actor.userId,
                    dueAt: "2026-10-15T03:00:00Z",
                };
                let task = await request("tasks", "POST", taskInput);
                await check(
                    "담당자 다음 행동 생성과 딜/고객 관계·재시도",
                    async () => {
                        assert.equal(task.dealId, deal.id);
                        assert.equal(
                            (await request("tasks", "POST", taskInput)).id,
                            task.id,
                        );
                        await assert.rejects(
                            request(
                                "tasks",
                                "POST",
                                {
                                    ...taskInput,
                                    workspaceId: 10,
                                    externalId: "bad-task",
                                    contactId: null,
                                },
                                null,
                                10,
                                clients.bo,
                            ),
                            (e) => e.status === 400,
                        );
                    },
                );
                await check(
                    "할 일 완료·재개·취소와 완료 시각·버전 경쟁",
                    async () => {
                        task = await request(
                            "tasks",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: task.version,
                                status: "done",
                            },
                            task.id,
                        );
                        assert.ok(task.completedAt);
                        await assert.rejects(
                            request(
                                "tasks",
                                "PATCH",
                                { workspaceId: 8, version: 1, status: "open" },
                                task.id,
                            ),
                            (e) => e.status === 409,
                        );
                        task = await request(
                            "tasks",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: task.version,
                                status: "open",
                            },
                            task.id,
                        );
                        assert.equal(task.completedAt, null);
                        task = await request(
                            "tasks",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: task.version,
                                status: "cancelled",
                            },
                            task.id,
                        );
                        assert.equal(
                            (
                                await request(
                                    "tasks",
                                    "GET",
                                    null,
                                    null,
                                    8,
                                    clients.dh,
                                    "&status=cancelled",
                                )
                            )[0].id,
                            task.id,
                        );
                    },
                );
                await check(
                    "딜 보관/복원과 전체 검색·파이프라인 필터",
                    async () => {
                        assert.equal(
                            (
                                await request(
                                    "deals",
                                    "GET",
                                    null,
                                    null,
                                    8,
                                    clients.dh,
                                    "&q=" +
                                        encodeURIComponent("디자인 구독") +
                                        "&pipelineId=" +
                                        pipeline.id,
                                )
                            ).length,
                            1,
                        );
                        deal = await request(
                            "deals",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: deal.version,
                                archived: true,
                            },
                            deal.id,
                        );
                        assert.equal((await request("deals")).length, 0);
                        assert.equal(
                            (
                                await request(
                                    "deals",
                                    "GET",
                                    null,
                                    null,
                                    8,
                                    clients.dh,
                                    "&archived=true",
                                )
                            ).length,
                            1,
                        );
                        deal = await request(
                            "deals",
                            "PATCH",
                            {
                                workspaceId: 8,
                                version: deal.version,
                                archived: false,
                            },
                            deal.id,
                        );
                        assert.equal((await request("deals")).length, 1);
                    },
                );
                await check(
                    "딜 이력 커서와 금액·날짜·입력 오류의 원자적 거절",
                    async () => {
                        const detail = await request(
                                "deals",
                                "GET",
                                null,
                                deal.id,
                            ),
                            next = await request(
                                "deals",
                                "GET",
                                null,
                                deal.id,
                                8,
                                clients.dh,
                                "&before=" + detail.history[0].id,
                            );
                        assert.equal(
                            next.history.length,
                            detail.history.length - 1,
                        );
                        const count = detail.history.length;
                        await assert.rejects(
                            request(
                                "deals",
                                "PATCH",
                                {
                                    workspaceId: 8,
                                    version: deal.version,
                                    amount: "-1",
                                },
                                deal.id,
                            ),
                            (e) => e.status === 400,
                        );
                        await assert.rejects(
                            request("tasks", "POST", {
                                ...taskInput,
                                externalId: "bad-date",
                                dueAt: "next monday",
                            }),
                            (e) => e.status === 400,
                        );
                        assert.equal(
                            (await request("deals", "GET", null, deal.id))
                                .history.length,
                            count,
                        );
                    },
                );
                await check(
                    "서버 SDK 영업 메서드와 명시적 undefined 필터",
                    async () => {
                        assert.equal(
                            (await clients.dh.pipelines(8))[0].id,
                            pipeline.id,
                        );
                        assert.equal(
                            (await clients.dh.deals(8, { q: undefined }))[0].id,
                            deal.id,
                        );
                        const newTask = await clients.dh.createTask({
                            workspaceId: 8,
                            externalId: "sdk-task",
                            title: "SDK 검증",
                            dealId: deal.id,
                        });
                        const done = await clients.dh.updateTask(newTask.id, {
                            workspaceId: 8,
                            version: newTask.version,
                            status: "done",
                        });
                        assert.equal(done.status, "done");
                        assert.ok(
                            (
                                await clients.dh.tasks(8, { status: "done" })
                            ).some((t) => t.id === newTask.id),
                        );
                    },
                );
                await check(
                    "직원 UI API 인증·조직 범위·파이프라인 관리자 권한·고객 전체 검색",
                    async () => {
                        const { NextRequest } = require("next/server"),
                            { generateToken } = require("../src/lib/auth.ts"),
                            routes = require("../src/app/api/customer-crm/[resource]/route.ts");
                        async function native(
                            resource,
                            method = "GET",
                            body,
                            who = actor,
                            q = "",
                        ) {
                            const token = who
                                ? generateToken({
                                      ...who,
                                      email: "qa@example.test",
                                  })
                                : null;
                            const req = new NextRequest(
                                `http://127.0.0.1:3120/api/customer-crm/${resource}?workspaceId=8${q}`,
                                {
                                    method,
                                    headers: {
                                        Origin: "http://127.0.0.1:3120",
                                        "Content-Type": "application/json",
                                        ...(token
                                            ? {
                                                  Authorization:
                                                      "Bearer " + token,
                                              }
                                            : {}),
                                    },
                                    ...(method === "GET"
                                        ? {}
                                        : { body: JSON.stringify(body) }),
                                },
                            );
                            return routes[method](req, {
                                params: Promise.resolve({ resource }),
                            });
                        }
                        assert.equal(
                            (await native("deals", "GET", undefined, null))
                                .status,
                            401,
                        );
                        assert.equal(
                            (
                                await native(
                                    "deals",
                                    "GET",
                                    undefined,
                                    otherActor,
                                )
                            ).status,
                            404,
                        );
                        await db.update(schema.organizationMembers).set({ role: "member" }).where(require("drizzle-orm").eq(schema.organizationMembers.userId, actor.userId));
                        assert.equal(
                            (
                                await native("pipelines", "POST", pipeInput, {
                                    ...actor,
                                    role: "owner",
                                })
                            ).status,
                            403,
                        );
                        await db.update(schema.organizationMembers).set({ role: "admin" }).where(require("drizzle-orm").eq(schema.organizationMembers.userId, actor.userId));
                        const result = await (
                            await native(
                                "contacts",
                                "GET",
                                undefined,
                                actor,
                                "&q=member@example.test",
                            )
                        ).json();
                        assert.equal(result.data.length, 1);
                        assert.equal(result.data[0].id, contacts.dh.id);
                        assert.equal(
                            (
                                await (
                                    await native(
                                        "contacts",
                                        "GET",
                                        undefined,
                                        actor,
                                        "&q=not-a-customer",
                                    )
                                ).json()
                            ).data.length,
                            0,
                        );
                    },
                );
                await check(
                    "100건 초과 딜과 동일 시각 변경 이력의 커서 누락 없음",
                    async () => {
                        const added = await db
                            .insert(schema.crmDeals)
                            .values(
                                Array.from({ length: 110 }, (_, i) => ({
                                    ...dealInput,
                                    orgId: actor.orgId,
                                    externalId: "qa-page-" + i,
                                })),
                            )
                            .returning();
                        const first = await clients.dh.deals(8),
                            second = await clients.dh.deals(8, {
                                before: first.at(-1).id,
                            });
                        assert.equal(
                            new Set([...first, ...second].map((row) => row.id))
                                .size,
                            111,
                        );
                        const stamp = new Date("2020-01-01");
                        await db
                            .insert(schema.crmDealHistory)
                            .values(
                                Array.from({ length: 110 }, () => ({
                                    dealId: deal.id,
                                    actorId: actor.userId,
                                    actorName: "가상 QA",
                                    change: { action: "page-test" },
                                    createdAt: stamp,
                                })),
                            );
                        const one = await request(
                                "deals",
                                "GET",
                                null,
                                deal.id,
                            ),
                            two = await request(
                                "deals",
                                "GET",
                                null,
                                deal.id,
                                8,
                                clients.dh,
                                "&before=" + one.history.at(-1).id,
                            );
                        assert.equal(
                            new Set(
                                [...one.history, ...two.history].map(
                                    (row) => row.id,
                                ),
                            ).size,
                            114,
                        );
                        const {
                            inArray,
                            eq,
                            and,
                            sql,
                        } = require("drizzle-orm");
                        await db.delete(schema.crmDeals).where(
                            inArray(
                                schema.crmDeals.id,
                                added.map((row) => row.id),
                            ),
                        );
                        await db
                            .delete(schema.crmDealHistory)
                            .where(
                                and(
                                    eq(schema.crmDealHistory.dealId, deal.id),
                                    sql`${schema.crmDealHistory.change}->>'action' = 'page-test'`,
                                ),
                            );
                    },
                );
                console.log(
                    `영업 플랫폼 API/SQL QA: ${checks}개 통과. 실제 외부 전송 0건.`,
                );
                if (extra)
                    await extra({ ...ctx, sales: { pipeline, deal, task } });
                else await pg.close();
            } catch (error) {
                throw error;
            }
        },
    );
}
if (require.main === module)
    runSalesCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runSalesCheck };
