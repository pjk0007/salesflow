/* eslint-disable @typescript-eslint/no-require-imports -- 실제 전송 없는 고객 활동·상담 결합 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto"),
    fs = require("node:fs"),
    path = require("node:path");
async function runActivityCheck(extra) {
    await require("./check-customer-sales.cjs").runSalesCheck(async (ctx) => {
        const {
                pg,
                db,
                actor,
                otherActor,
                clients,
                contacts,
                channels,
                repo,
                sales,
                modules,
            } = ctx,
            schema = require("../src/lib/db/schema.ts"),
            { eq, and } = require("drizzle-orm");
        const {
                inboxCustomerContext,
            } = require("../src/lib/customer-platform/inbox-context.ts"),
            {
                customerActivities,
            } = require("../src/lib/customer-platform/activities.ts"),
            {
                createSales,
            } = require("../src/lib/customer-platform/sales-repository.ts"),
            {
                recordCustomerEvent,
            } = require("../src/lib/customer-platform/repository.ts");
        const conversation = (
            await clients.dh.conversations(channels.dh.id)
        ).find((c) => c.contactId === contacts.dh.id);
        const activity = (before) =>
            clients.dh.customerActivities(8, contacts.dh.id, before);
        let checks = 0;
        async function check(name, fn) {
            await fn();
            console.log(`PASS ACTIVITY ${++checks} ${name}`);
        }
        await check(
            "회원 상담에서 고객·회사·진행 거래를 같은 범위로 조회",
            async () => {
                const data = await inboxCustomerContext(
                    actor,
                    conversation.id,
                    db,
                );
                assert.equal(data.contact.id, contacts.dh.id);
                assert.equal(data.companies.length, 1);
                assert.ok(data.deals.some((d) => d.id === sales.deal.id));
                assert.ok(!data.tasks.some((t) => t.status !== "open"));
                await assert.rejects(
                    inboxCustomerContext(otherActor, conversation.id, db),
                    (e) => e.status === 404,
                );
                const anonymous = (
                    await clients.dh.conversations(channels.dh.id)
                ).find((c) => !c.contactId);
                assert.equal(
                    (await inboxCustomerContext(actor, anonymous.id, db))
                        .contact,
                    null,
                );
            },
        );
        const task = await clients.dh.createTask({
            workspaceId: 8,
            externalId: "activity-next",
            title: "상담 중 만든 후속 업무",
            contactId: contacts.dh.id,
            dealId: sales.deal.id,
            ownerId: actor.userId,
        });
        await check(
            "업무 생성·완료와 딜 감사가 공통 고객 타임라인에 보존",
            async () => {
                const done = await clients.dh.updateTask(task.id, {
                    workspaceId: 8,
                    version: task.version,
                    status: "done",
                });
                assert.equal(done.status, "done");
                const rows = await activity();
                assert.equal(
                    rows.filter((row) => row.entityId === task.id).length,
                    2,
                );
                assert.ok(
                    rows.some(
                        (row) =>
                            row.entityId === task.id &&
                            row.action === "created",
                    ),
                );
                assert.ok(
                    rows.some(
                        (row) =>
                            row.entityId === task.id && row.action === "done",
                    ),
                );
                assert.ok(
                    rows.some(
                        (row) =>
                            row.source === "deal" &&
                            row.entityId === sales.deal.id,
                    ),
                );
                assert.ok(
                    !(
                        await inboxCustomerContext(actor, conversation.id, db)
                    ).tasks.some((t) => t.id === task.id),
                );
            },
        );
        await check(
            "상담 공개 답변·고객 이벤트의 재시도는 활동 한 건 · 내부 메모 제외",
            async () => {
                const message = {
                    clientId: randomUUID(),
                    kind: "reply",
                    body: "공통 활동 공개 답변",
                };
                await repo.sendAgentMessage(
                    actor,
                    conversation.id,
                    message,
                    db,
                );
                await repo.sendAgentMessage(
                    actor,
                    conversation.id,
                    message,
                    db,
                );
                await repo.sendAgentMessage(
                    actor,
                    conversation.id,
                    {
                        ...message,
                        clientId: randomUUID(),
                        kind: "note",
                        body: "공통 활동에서 제외할 비공개 QA 메모",
                    },
                    db,
                );
                const event = {
                    eventId: randomUUID(),
                    name: "common_event",
                    properties: { plan: "pro" },
                };
                await recordCustomerEvent(
                    actor.orgId,
                    8,
                    contacts.dh.id,
                    event,
                    "server",
                    db,
                );
                await recordCustomerEvent(
                    actor.orgId,
                    8,
                    contacts.dh.id,
                    event,
                    "server",
                    db,
                );
                const rows = await activity();
                assert.equal(
                    rows.filter((row) => row.summary === message.body).length,
                    1,
                );
                assert.equal(
                    rows.filter((row) => row.name === "common_event").length,
                    1,
                );
                assert.ok(!JSON.stringify(rows).includes("비공개 QA 메모"));
                await assert.rejects(
                    clients.bo.request(
                        `/api/v1/crm/contacts/${contacts.dh.id}/activity?workspaceId=8`,
                    ),
                    (e) => e.status === 403,
                );
            },
        );
        await check(
            "원본 업무·이벤트·상담과 활동 기록의 트랜잭션 롤백",
            async () => {
                const original = (await activity()).length,
                    detail = await repo.conversationDetail(
                        actor,
                        conversation.id,
                        db,
                    );
                await assert.rejects(
                    db.transaction(async (tx) => {
                        await createSales(
                            actor,
                            "tasks",
                            {
                                workspaceId: 8,
                                externalId: "rolled-back",
                                title: "되돌릴 업무",
                                contactId: contacts.dh.id,
                            },
                            tx,
                        );
                        await recordCustomerEvent(
                            actor.orgId,
                            8,
                            contacts.dh.id,
                            {
                                eventId: randomUUID(),
                                name: "rolled_back_event",
                            },
                            "server",
                            tx,
                        );
                        await repo.sendAgentMessage(
                            actor,
                            conversation.id,
                            {
                                clientId: randomUUID(),
                                kind: "reply",
                                body: "되돌릴 답변",
                            },
                            tx,
                        );
                        throw new Error("의도적 롤백");
                    }),
                    /의도적 롤백/,
                );
                assert.equal((await activity()).length, original);
                assert.equal(
                    (await repo.conversationDetail(actor, conversation.id, db))
                        .messages.length,
                    detail.messages.length,
                );
                assert.equal(
                    (
                        await db
                            .select()
                            .from(schema.crmTasks)
                            .where(
                                eq(schema.crmTasks.externalId, "rolled-back"),
                            )
                    ).length,
                    0,
                );
            },
        );
        await check(
            "같은 시각 100개 초과 활동의 커서와 다른 고객 커서 격리",
            async () => {
                const original = (await activity()).length,
                    stamp = new Date("2020-01-01");
                const added = await db
                    .insert(schema.crmActivities)
                    .values(
                        Array.from({ length: 110 }, (_, i) => ({
                            orgId: actor.orgId,
                            workspaceId: 8,
                            contactId: contacts.dh.id,
                            source: "event",
                            entityId: randomUUID(),
                            eventKey: "activity-page-" + i,
                            action: "page",
                            summary: "가상 페이지 QA",
                            occurredAt: stamp,
                        })),
                    )
                    .returning();
                const first = await activity(),
                    second = await activity(first.at(-1).id);
                assert.equal(
                    new Set([...first, ...second].map((row) => row.id)).size,
                    original + 110,
                );
                await assert.rejects(
                    customerActivities(
                        actor.orgId,
                        8,
                        contacts.dh.id,
                        randomUUID(),
                        db,
                    ),
                    (e) => e.status === 400,
                );
                const { inArray } = require("drizzle-orm");
                await db.delete(schema.crmActivities).where(
                    inArray(
                        schema.crmActivities.id,
                        added.map((row) => row.id),
                    ),
                );
            },
        );
        await check(
            "기존 기록 복원은 반복 가능 · 삭제된 고객·비공개 메모·업무 스냅샷 처리",
            async () => {
                const temporary = await clients.dh.upsertContact({
                        workspaceId: 8,
                        externalId: "activity-temp",
                        name: "가상 삭제 시험",
                    }),
                    deal = await clients.dh.createDeal({
                        workspaceId: 8,
                        externalId: "activity-temp-deal",
                        title: "가상 삭제 고객 딜",
                        pipelineId: sales.pipeline.id,
                        stageId: sales.pipeline.stages[0].id,
                        contactId: temporary.id,
                        amount: "0",
                        currency: "KRW",
                    });
                await db
                    .delete(schema.crmContacts)
                    .where(eq(schema.crmContacts.id, temporary.id));
                await db
                    .delete(schema.crmActivities)
                    .where(
                        and(
                            eq(schema.crmActivities.orgId, actor.orgId),
                            eq(schema.crmActivities.workspaceId, 8),
                        ),
                    );
                const backfill = fs
                    .readFileSync(
                        path.join(
                            __dirname,
                            "../drizzle/0091_customer_activities.sql",
                        ),
                        "utf8",
                    )
                    .split("--> statement-breakpoint")[1];
                await pg.exec(backfill);
                const once = await db.select().from(schema.crmActivities);
                await pg.exec(backfill);
                assert.equal(
                    (await db.select().from(schema.crmActivities)).length,
                    once.length,
                );
                const rows = await activity();
                assert.ok(!JSON.stringify(rows).includes("비공개 QA 메모"));
                assert.ok(
                    rows.some(
                        (row) =>
                            row.source === "task" && row.action === "snapshot",
                    ),
                );
                assert.ok(
                    rows.some((row) => row.summary === "공통 활동 공개 답변"),
                );
                const tempRows = once.filter((row) => row.entityId === deal.id);
                assert.ok(tempRows.every((row) => row.contactId === null));
                await db
                    .delete(schema.crmDeals)
                    .where(eq(schema.crmDeals.id, deal.id));
            },
        );
        await check(
            "상담 CRM·공통 타임라인 직원 API 인증과 조직 경계",
            async () => {
                const { NextRequest } = require("next/server"),
                    { generateToken } = require("../src/lib/auth.ts");
                async function get(file, url, who) {
                    return modules[file].GET(
                        new NextRequest(url, {
                            headers: who
                                ? {
                                      Authorization:
                                          "Bearer " +
                                          generateToken({
                                              ...who,
                                              email: "qa@example.test",
                                          }),
                                  }
                                : {},
                        }),
                        {
                            params: Promise.resolve({
                                id: file.includes("/customer")
                                    ? conversation.id
                                    : contacts.dh.id,
                            }),
                        },
                    );
                }
                const url = `http://127.0.0.1:3120/api/inbox/conversations/${conversation.id}/customer`,
                    file = "inbox/conversations/[id]/customer";
                assert.equal((await get(file, url, null)).status, 401);
                assert.equal((await get(file, url, otherActor)).status, 404);
                assert.equal((await get(file, url, actor)).status, 200);
                const activityUrl = `http://127.0.0.1:3120/api/customer-crm/contacts/${contacts.dh.id}/activity?workspaceId=8`,
                    activityFile = "customer-crm/contacts/[id]/activity";
                assert.equal(
                    (await get(activityFile, activityUrl, null)).status,
                    401,
                );
                assert.equal(
                    (await get(activityFile, activityUrl, otherActor)).status,
                    404,
                );
            },
        );
        console.log(
            `상담·공통 고객 활동 QA: ${checks}개 통과. 실제 외부 전송 0건.`,
        );
        if (extra) await extra(ctx);
        else await pg.close();
    });
}
if (require.main === module)
    runActivityCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runActivityCheck };
