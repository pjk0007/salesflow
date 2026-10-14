/* eslint-disable @typescript-eslint/no-require-imports -- 격리 DB와 가상 수신기, 외부 HTTP 전송 없음 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
async function runWebhookCheck(extra) {
    await require("./check-inbox-files.cjs").runFilesCheck(async (ctx) => {
        const {
                db,
                pg,
                actor,
                otherActor,
                clients,
                contacts,
                channels,
                repo,
                platform,
                modules,
            } = ctx,
            schema = require("../src/lib/db/schema.ts"),
            { eq, and, sql } = require("drizzle-orm"),
            service = require("../src/lib/customer-platform/webhook-repository.ts"),
            {
                processWebhookDeliveries,
            } = require("../src/lib/customer-platform/webhook-worker.ts"),
            { verifySendbWebhook } = require("../sdk/webhooks.ts"),
            {
                enqueuePlatformEvent,
            } = require("../src/lib/customer-platform/outbox.ts"),
            { NextRequest } = require("next/server"),
            { generateToken } = require("../src/lib/auth.ts");
        let checks = 0;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS WEBHOOK ${++checks} ${name}`);
        };
        const count = async (table, where) =>
            Number(
                (
                    await db
                        .select({ n: sql`count(*)` })
                        .from(table)
                        .where(where)
                )[0].n,
            );
        const chat = (await clients.dh.conversations(channels.dh.id)).find(
            (c) => c.contactId === contacts.dh.id,
        );
        const dh = await clients.dh.createWebhook({
            workspaceId: 8,
            name: "가상 디하 수신",
            url: "https://dh-receiver.example.test/sendb",
            eventTypes: (await clients.dh.webhooks(8)).eventTypes,
        });
        const bo = await clients.bo.createWebhook({
            workspaceId: 10,
            name: "가상 백오랩 수신",
            url: "https://bo-receiver.example.test/sendb",
            eventTypes: ["message.created", "customer.event"],
        });
        let dhEndpoint = dh.endpoint,
            boEndpoint = bo.endpoint;
        await check(
            "서명 키 일회 응답·암호화 저장·기본 꺼짐·이전 이벤트 소급 없음",
            async () => {
                assert.equal(dh.endpoint.enabled, false);
                assert.match(dh.secret, /^whsec_/);
                assert.equal(await count(schema.platformWebhookDeliveries), 0);
                const dto = await clients.dh.webhooks(8);
                assert.ok(!JSON.stringify(dto).includes(dh.secret));
                assert.ok(!JSON.stringify(dto).includes("secretCipher"));
                const [stored] = await db
                    .select()
                    .from(schema.platformWebhooks)
                    .where(eq(schema.platformWebhooks.id, dh.endpoint.id));
                assert.notEqual(stored.secretCipher, dh.secret);
                dhEndpoint = (
                    await clients.dh.updateWebhook(dh.endpoint.id, {
                        version: 1,
                        enabled: true,
                    })
                ).endpoint;
                boEndpoint = (
                    await clients.bo.updateWebhook(bo.endpoint.id, {
                        version: 1,
                        enabled: true,
                    })
                ).endpoint;
            },
        );
        await check(
            "원본 고객/회사 upsert 실제 변경만 이벤트·재시도 중복 없음",
            async () => {
                const companyInput = {
                        workspaceId: 8,
                        externalId: "webhook-company",
                        name: "가상 웹훅 회사",
                        attributes: { plan: "a" },
                    },
                    company = await clients.dh.upsertCompany(companyInput);
                await clients.dh.upsertCompany(companyInput);
                await clients.dh.upsertCompany({
                    ...companyInput,
                    attributes: { plan: "b" },
                });
                const contactInput = {
                        workspaceId: 8,
                        externalId: "webhook-customer",
                        name: "가상 웹훅 고객",
                        companyIds: [company.id],
                    },
                    contact = await clients.dh.upsertContact(contactInput);
                await clients.dh.upsertContact(contactInput);
                await clients.dh.upsertContact({
                    ...contactInput,
                    phone: "000-QA",
                });
                const events = await db.select().from(schema.platformEvents);
                assert.equal(
                    events.filter(
                        (e) => e.payload.data.company?.id === company.id,
                    ).length,
                    2,
                );
                assert.equal(
                    events.filter(
                        (e) => e.payload.data.contact?.id === contact.id,
                    ).length,
                    2,
                );
            },
        );
        await check(
            "회원·익명 공개 상담과 상태 이벤트, 내부 메모 제외",
            async () => {
                const before = await count(
                    schema.platformEvents,
                    eq(schema.platformEvents.type, "message.created"),
                );
                const anon = await repo.startVisitorSession(
                        channels.dh.publicKey,
                        { name: "가상 웹훅 익명" },
                        db,
                    ),
                    payload = {
                        clientId: randomUUID(),
                        body: "공개 웹훅 문의",
                    };
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    anon.token,
                    payload,
                    db,
                );
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    anon.token,
                    payload,
                    db,
                );
                await repo.sendAgentMessage(
                    actor,
                    anon.id,
                    {
                        clientId: randomUUID(),
                        kind: "note",
                        body: "WEBHOOK_PRIVATE_NOTE_DO_NOT_SEND",
                    },
                    db,
                );
                await repo.patchConversation(
                    actor,
                    anon.id,
                    { status: "closed" },
                    db,
                );
                assert.equal(
                    await count(
                        schema.platformEvents,
                        eq(schema.platformEvents.type, "message.created"),
                    ),
                    before + 1,
                );
                const events = await db.select().from(schema.platformEvents);
                assert.ok(
                    events.some(
                        (e) =>
                            e.type === "conversation.created" &&
                            e.payload.data.conversationId === anon.id,
                    ),
                );
                assert.ok(
                    !JSON.stringify(events.map((e) => e.payload)).includes(
                        "WEBHOOK_PRIVATE_NOTE_DO_NOT_SEND",
                    ),
                );
            },
        );
        await check(
            "고객 행동·영업·파이프라인 원본 저장과 같은 이벤트 계약",
            async () => {
                const event = { eventId: randomUUID(), name: "가상 관심" };
                await clients.dh.track(8, contacts.dh.id, event);
                await clients.dh.track(8, contacts.dh.id, event);
                await clients.bo.track(10, contacts.bo.id, {
                    eventId: randomUUID(),
                    name: "백오랩 관심",
                });
                const pipeline = await clients.dh.createPipeline({
                    workspaceId: 8,
                    externalId: "webhook-pipeline",
                    name: "웹훅 QA",
                    stages: [
                        { id: randomUUID(), name: "검토", category: "open" },
                    ],
                });
                await clients.dh.updatePipeline(pipeline.id, {
                    workspaceId: 8,
                    version: pipeline.version,
                    name: "QA 변경",
                });
                const deal = await clients.dh.createDeal({
                    workspaceId: 8,
                    externalId: "webhook-deal",
                    title: "가상 계약",
                    pipelineId: pipeline.id,
                    stageId: pipeline.stages[0].id,
                    contactId: contacts.dh.id,
                    amount: "100",
                    currency: "KRW",
                });
                await clients.dh.updateDeal(deal.id, {
                    workspaceId: 8,
                    version: deal.version,
                    notes: "가상 메모",
                });
                const task = await clients.dh.createTask({
                    workspaceId: 8,
                    externalId: "webhook-task",
                    title: "가상 후속",
                    contactId: contacts.dh.id,
                });
                await clients.dh.updateTask(task.id, {
                    workspaceId: 8,
                    version: task.version,
                    status: "done",
                });
                const rows = await db.select().from(schema.platformEvents);
                for (const kind of [
                    "customer.event",
                    "pipeline.created",
                    "pipeline.updated",
                    "deal.created",
                    "deal.updated",
                    "task.created",
                    "task.updated",
                ])
                    assert.ok(
                        rows.some((e) => e.type === kind),
                        kind,
                    );
                assert.equal(
                    rows.filter(
                        (e) => e.payload.data.event?.eventId === event.eventId,
                    ).length,
                    1,
                );
            },
        );
        await check(
            "CRM 프로필 갱신은 상담 version·이벤트도 실제 변경 때만 반영",
            async () => {
                const before = (
                    await repo.conversationDetail(actor, chat.id, db)
                ).conversation;
                await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "member-1",
                    name: "가상 회원 프로필 변경",
                });
                const after = (
                    await repo.conversationDetail(actor, chat.id, db)
                ).conversation;
                assert.equal(after.version, before.version + 1);
                await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "member-1",
                    name: "가상 회원 프로필 변경",
                });
                assert.equal(
                    (await repo.conversationDetail(actor, chat.id, db))
                        .conversation.version,
                    after.version,
                );
            },
        );
        await check("원본·이벤트·전달 대기열 전체 롤백", async () => {
            const before = await count(schema.platformEvents),
                deliveryCount = await count(schema.platformWebhookDeliveries);
            await assert.rejects(
                db.transaction(async (tx) => {
                    await platform.upsertCompany(
                        actor.orgId,
                        {
                            workspaceId: 8,
                            externalId: "rollback-webhook",
                            name: "롤백",
                        },
                        true,
                        tx,
                    );
                    await repo.sendAgentMessage(
                        actor,
                        chat.id,
                        {
                            clientId: randomUUID(),
                            kind: "reply",
                            body: "롤백 답변",
                        },
                        tx,
                    );
                    throw new Error("outbox rollback");
                }),
                /outbox rollback/,
            );
            assert.equal(await count(schema.platformEvents), before);
            assert.equal(
                await count(schema.platformWebhookDeliveries),
                deliveryCount,
            );
            assert.equal(
                await count(
                    schema.crmCompanies,
                    eq(schema.crmCompanies.externalId, "rollback-webhook"),
                ),
                0,
            );
        });
        const sent = [];
        let now = new Date();
        const accept = async (url, body, headers) => {
            const secret = url.includes("dh-receiver") ? dh.secret : bo.secret;
            assert.ok(
                verifySendbWebhook(
                    body,
                    {
                        id: headers["X-Sendb-Id"],
                        timestamp: headers["X-Sendb-Timestamp"],
                        signature: headers["X-Sendb-Signature"],
                    },
                    secret,
                    now,
                ),
            );
            sent.push({ url, body, headers });
            return { status: 204, retryAfter: null };
        };
        await check("실제 워커의 서명·사업 구독 fanout·성공 이력", async () => {
            for (let i = 0; i < 5; i++) {
                const result = await processWebhookDeliveries({
                    exec: db,
                    send: accept,
                    now: () => now,
                    limit: 20,
                });
                if (!result.processed) break;
            }
            assert.ok(sent.length > 10);
            for (const item of sent)
                assert.ok(BigInt(JSON.parse(item.body).sequence) > 0n);
            const records = await db.select().from(schema.platformEvents),
                companyChanges = records.filter(
                    (e) =>
                        e.payload.data.company?.externalId ===
                        "webhook-company",
                );
            assert.ok(
                companyChanges.find((e) => e.type === "company.updated")
                    .sequence >
                    companyChanges.find((e) => e.type === "company.created")
                        .sequence,
            );
            const attemptRows = await db
                .select()
                .from(schema.platformWebhookAttempts);
            assert.ok(
                attemptRows.every((a) =>
                    /^https:\/\/(dh|bo)-receiver\.example\.test\/sendb$/.test(
                        a.url,
                    ),
                ),
            );
            for (const item of sent) {
                const event = JSON.parse(item.body);
                assert.equal(
                    event.workspaceId,
                    item.url.includes("bo-receiver") ? 10 : 8,
                );
                assert.ok(
                    !item.body.includes("WEBHOOK_PRIVATE_NOTE_DO_NOT_SEND"),
                );
            }
            assert.equal(
                await count(
                    schema.platformWebhookDeliveries,
                    eq(schema.platformWebhookDeliveries.state, "pending"),
                ),
                0,
            );
            assert.equal(
                await count(
                    schema.platformWebhookAttempts,
                    eq(schema.platformWebhookAttempts.state, "succeeded"),
                ),
                sent.length,
            );
        });
        async function queue() {
            const clientId = randomUUID();
            await service.testWebhook(actor, dhEndpoint.id, clientId, db);
            now = new Date(Math.max(now.getTime(), Date.now() + 1));
            return (
                await service.webhookDeliveryPage(
                    actor,
                    dhEndpoint.id,
                    undefined,
                    "pending",
                    db,
                )
            ).rows.find((r) => r.type === "platform.test");
        }
        await check(
            "실패 재시도·Retry-After·이벤트 ID와 원문 보존",
            async () => {
                const delivery = await queue(),
                    calls = [];
                await processWebhookDeliveries({
                    exec: db,
                    limit: 1,
                    now: () => now,
                    send: async (url, body, headers) => {
                        calls.push({ body, headers });
                        return { status: 429, retryAfter: "180" };
                    },
                });
                const failed = await service.webhookDeliveryDetail(
                    actor,
                    delivery.id,
                    db,
                );
                assert.equal(failed.delivery.state, "retry");
                assert.equal(
                    failed.delivery.availableAt.getTime(),
                    now.getTime() + 180000,
                );
                assert.equal(
                    (
                        await processWebhookDeliveries({
                            exec: db,
                            limit: 1,
                            now: () => now,
                            send: accept,
                        })
                    ).processed,
                    0,
                );
                now = new Date(now.getTime() + 180001);
                await processWebhookDeliveries({
                    exec: db,
                    limit: 1,
                    now: () => now,
                    send: async (url, body, headers) => {
                        calls.push({ body, headers });
                        return accept(url, body, headers);
                    },
                });
                assert.equal(calls[0].body, calls[1].body);
                assert.equal(
                    calls[0].headers["X-Sendb-Id"],
                    calls[1].headers["X-Sendb-Id"],
                );
                assert.equal(
                    (
                        await service.webhookDeliveryDetail(
                            actor,
                            delivery.id,
                            db,
                        )
                    ).attempts.length,
                    2,
                );
            },
        );
        await check(
            "8회 실패 후 중단·수동 재시도는 같은 이벤트 이력 유지",
            async () => {
                const delivery = await queue();
                for (let i = 0; i < 8; i++) {
                    await processWebhookDeliveries({
                        exec: db,
                        now: () => now,
                        limit: 1,
                        send: async () => ({ status: 503, retryAfter: null }),
                    });
                    now = new Date(now.getTime() + 86400001);
                }
                assert.equal(
                    (
                        await service.webhookDeliveryDetail(
                            actor,
                            delivery.id,
                            db,
                        )
                    ).delivery.state,
                    "dead",
                );
                await clients.dh.retryWebhookDelivery(delivery.id);
                now = new Date(Math.max(now.getTime(), Date.now()));
                await processWebhookDeliveries({
                    exec: db,
                    now: () => now,
                    limit: 1,
                    send: accept,
                });
                const result = await service.webhookDeliveryDetail(
                    actor,
                    delivery.id,
                    db,
                );
                assert.equal(result.delivery.eventId, delivery.eventId);
                assert.equal(result.delivery.attempts, 9);
                assert.equal(result.delivery.state, "succeeded");
            },
        );
        await check(
            "워커 중단 lease 복원·미확인 시도와 새 시도 분리",
            async () => {
                const delivery = await queue(),
                    leaseId = randomUUID();
                await db
                    .update(schema.platformWebhookDeliveries)
                    .set({
                        state: "processing",
                        attempts: 1,
                        cycleAttempts: 1,
                        leaseId,
                        leaseUntil: new Date(now.getTime() - 1000),
                    })
                    .where(
                        eq(schema.platformWebhookDeliveries.id, delivery.id),
                    );
                await db.insert(schema.platformWebhookAttempts).values({
                    deliveryId: delivery.id,
                    url: "https://dh-receiver.example.test/sendb",
                    attempt: 1,
                    leaseId,
                    state: "sending",
                });
                await processWebhookDeliveries({
                    exec: db,
                    now: () => now,
                    limit: 1,
                    send: accept,
                });
                const result = await service.webhookDeliveryDetail(
                    actor,
                    delivery.id,
                    db,
                );
                assert.equal(result.attempts[0].state, "succeeded");
                assert.equal(result.attempts[1].state, "unknown");
            },
        );
        await check(
            "중복 워커는 같은 lease를 공유하지 않음·설정 취소 뒤 늦은 응답 보호",
            async () => {
                const delivery = await queue();
                let started, finish;
                const began = new Promise((resolve) => (started = resolve)),
                    blocked = new Promise((resolve) => (finish = resolve));
                const job = processWebhookDeliveries({
                    exec: db,
                    now: () => now,
                    limit: 1,
                    send: async () => {
                        started();
                        await blocked;
                        return { status: 200, retryAfter: null };
                    },
                });
                await began;
                assert.equal(
                    (
                        await processWebhookDeliveries({
                            exec: db,
                            now: () => now,
                            limit: 1,
                            send: accept,
                        })
                    ).processed,
                    0,
                );
                dhEndpoint = (
                    await clients.dh.updateWebhook(dhEndpoint.id, {
                        version: dhEndpoint.version,
                        enabled: false,
                    })
                ).endpoint;
                finish();
                await job;
                const result = await service.webhookDeliveryDetail(
                    actor,
                    delivery.id,
                    db,
                );
                assert.equal(result.delivery.state, "cancelled");
                assert.equal(result.attempts[0].state, "succeeded");
            },
        );
        await check(
            "설정 충돌·키 회전·이전 대기 취소·명시적 새 설정 재전달",
            async () => {
                await assert.rejects(
                    clients.dh.updateWebhook(dhEndpoint.id, {
                        version: 1,
                        enabled: true,
                    }),
                    (e) => e.status === 409,
                );
                dhEndpoint = (
                    await clients.dh.updateWebhook(dhEndpoint.id, {
                        version: dhEndpoint.version,
                        enabled: true,
                    })
                ).endpoint;
                const pending = await queue();
                dhEndpoint = (
                    await clients.dh.updateWebhook(dhEndpoint.id, {
                        version: dhEndpoint.version,
                        name: "가상 디하 수신 이름 변경",
                    })
                ).endpoint;
                assert.equal(
                    (await service.webhookDeliveryDetail(actor, pending.id, db))
                        .delivery.state,
                    "pending",
                );
                const rotated = await clients.dh.request(
                    `/api/v1/webhooks/${dhEndpoint.id}`,
                    "POST",
                    { action: "rotate", version: dhEndpoint.version },
                );
                dhEndpoint = rotated.endpoint;
                assert.equal(
                    (await service.webhookDeliveryDetail(actor, pending.id, db))
                        .delivery.state,
                    "cancelled",
                );
                assert.notEqual(rotated.secret, dh.secret);
                await clients.dh.retryWebhookDelivery(pending.id);
                await processWebhookDeliveries({
                    exec: db,
                    now: () => now,
                    limit: 1,
                    send: async (url, body, headers) => {
                        assert.ok(
                            verifySendbWebhook(
                                body,
                                {
                                    id: headers["X-Sendb-Id"],
                                    timestamp: headers["X-Sendb-Timestamp"],
                                    signature: headers["X-Sendb-Signature"],
                                },
                                rotated.secret,
                                now,
                            ),
                        );
                        return { status: 200, retryAfter: null };
                    },
                });
                assert.equal(
                    (await service.webhookDeliveryDetail(actor, pending.id, db))
                        .delivery.state,
                    "succeeded",
                );
            },
        );
        await check("API 사업·조직·권한·현재 관리자 역할 검증", async () => {
            await assert.rejects(
                clients.bo.webhooks(8),
                (e) => e.status === 403,
            );
            await assert.rejects(
                clients.bo.updateWebhook(dhEndpoint.id, {
                    version: dhEndpoint.version,
                    enabled: false,
                }),
                (e) => e.status === 403,
            );
            await assert.rejects(
                service.ownedWebhook(otherActor, dhEndpoint.id, db),
                (e) => e.status === 404,
            );
            await assert.rejects(
                clients.read.createWebhook({
                    workspaceId: 8,
                    name: "차단",
                    url: "https://no.example.test/",
                    eventTypes: ["message.created"],
                }),
                (e) => e.status === 403,
            );
            const native = modules["customer-platform/webhooks"],
                url =
                    "http://127.0.0.1:3120/api/customer-platform/webhooks?workspaceId=8";
            assert.equal((await native.GET(new NextRequest(url))).status, 401);
            await db
                .update(schema.organizationMembers)
                .set({ role: "member" })
                .where(
                    and(
                        eq(
                            schema.organizationMembers.organizationId,
                            actor.orgId,
                        ),
                        eq(schema.organizationMembers.userId, actor.userId),
                    ),
                );
            await assert.rejects(
                clients.dh.createWebhook({
                    workspaceId: 8,
                    name: "오래된 관리자",
                    url: "https://no.example.test/",
                    eventTypes: ["message.created"],
                }),
                (e) => e.status === 403,
            );
            const response = await native.POST(
                new NextRequest(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${generateToken({ ...actor, email: "qa@example.test" })}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        workspaceId: 8,
                        name: "오래된 관리자",
                        url: "https://no.example.test/",
                        eventTypes: ["message.created"],
                    }),
                }),
            );
            assert.equal(response.status, 403);
            await db
                .update(schema.organizationMembers)
                .set({ role: "admin" })
                .where(eq(schema.organizationMembers.userId, actor.userId));
        });
        await check(
            "전달 상세·설정 감사·동일 시각 100건 커서·타 사업 커서 격리",
            async () => {
                const values = [];
                for (let i = 0; i < 105; i++) {
                    const event = await db.transaction((tx) =>
                        enqueuePlatformEvent(tx, {
                            orgId: actor.orgId,
                            workspaceId: 8,
                            key: "cursor:" + i,
                            type: "platform.test",
                            data: { qa: true },
                            endpointId: dhEndpoint.id,
                        }),
                    );
                    values.push(event.id);
                }
                await db
                    .update(schema.platformWebhookDeliveries)
                    .set({ createdAt: new Date("2030-01-01") })
                    .where(
                        sql`${schema.platformWebhookDeliveries.eventId} in (${sql.join(
                            values.map((v) => sql`${v}`),
                            sql`,`,
                        )})`,
                    );
                const first = await clients.dh.webhookDeliveries(dhEndpoint.id),
                    second = await clients.dh.webhookDeliveries(
                        dhEndpoint.id,
                        first.rows.at(-1).id,
                    );
                assert.equal(first.rows.length, 100);
                assert.equal(
                    new Set([...first.rows, ...second.rows].map((r) => r.id))
                        .size,
                    first.rows.length + second.rows.length,
                );
                await assert.rejects(
                    service.webhookDeliveryPage(
                        actor,
                        boEndpoint.id,
                        first.rows[0].id,
                        undefined,
                        db,
                    ),
                    (e) => e.status === 404,
                );
                assert.ok(
                    (
                        await service.webhookDetail(actor, dhEndpoint.id, db)
                    ).history.some((a) => a.action === "secret.rotated"),
                );
            },
        );
        console.log(
            `플랫폼 웹훅 QA: ${checks}개 통과. 실제 수신기 HTTP/고객 발송 0건.`,
        );
        if (extra) await extra(ctx);
        else await pg.close();
    });
}
if (require.main === module)
    runWebhookCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runWebhookCheck };
