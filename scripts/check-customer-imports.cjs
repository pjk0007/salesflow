/* eslint-disable @typescript-eslint/no-require-imports -- 격리 자료 이전·실제 API/SQL 검증 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
async function runImportCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const {
                    db,
                    pg,
                    actor,
                    clients,
                    channels,
                    contacts,
                    repo,
                    otherActor,
                    modules,
                } = ctx,
                s = require("../src/lib/db/schema.ts"),
                { eq, sql } = require("drizzle-orm");
            const imports = require("../src/lib/customer-imports/repository.ts");
            const request = (client, path = "", method = "GET", body) =>
                client.request("/api/v1/imports" + path, method, body);
            const date = "2024-01-01T03:00:00.000Z";
            const bundle = {
                companies: [
                    {
                        id: "co",
                        name: "이전 가상 기업",
                        domain: "example.test",
                    },
                ],
                contacts: [
                    {
                        id: "c",
                        name: "원본 고객 표시",
                        externalId: "member-1",
                        email: "old-member@example.test",
                        companyIds: ["co"],
                    },
                ],
                pipelines: [
                    {
                        id: "p",
                        name: "이전 영업",
                        stages: [
                            { id: "new", name: "도입 검토", category: "open" },
                            { id: "won", name: "계약 완료", category: "won" },
                        ],
                    },
                ],
                deals: [
                    {
                        id: "d",
                        title: "이전 가상 계약",
                        pipelineId: "p",
                        stageId: "new",
                        contactId: "c",
                        companyId: "co",
                        amount: "150000",
                        currency: "KRW",
                    },
                ],
                tasks: [
                    {
                        id: "t",
                        title: "이전 후속 확인",
                        contactId: "c",
                        companyId: "co",
                        dealId: "d",
                        status: "open",
                    },
                ],
                conversations: [
                    {
                        id: "v1",
                        contactId: "c",
                        name: "이전 첫 상담",
                        status: "open",
                        createdAt: date,
                    },
                    {
                        id: "v2",
                        contactId: "c",
                        name: "이전 두 번째 상담",
                        status: "closed",
                        createdAt: date,
                    },
                ],
                messages: [
                    {
                        id: "m2",
                        conversationId: "v1",
                        messageKind: "reply",
                        body: "이전 공개 답변",
                        authorName: "원본 상담원",
                        createdAt: "2024-01-02T03:00:00.000Z",
                        files: [{ name: "원본자료.pdf", id: "f" }],
                    },
                    {
                        id: "m1",
                        conversationId: "v1",
                        messageKind: "customer",
                        body: "이전 문의",
                        authorName: "원본 고객",
                        createdAt: date,
                    },
                    {
                        id: "note",
                        conversationId: "v1",
                        messageKind: "note",
                        body: "이전 내부 메모 · 고객에게 비공개",
                        authorName: "원본 상담원",
                        createdAt: date,
                    },
                ],
            };
            const input = (part = {}) => ({
                workspaceId: 8,
                source: "portable",
                namespace: "격리 이전 QA",
                format: "json",
                content: JSON.stringify(bundle),
                ...part,
            });
            const preview = (body) => request(clients.dh, "", "POST", body);
            const start = (job) =>
                request(clients.dh, "/" + job.id, "POST", {
                    action: "start",
                    version: job.version,
                    fingerprint: job.fingerprint,
                    acknowledge: true,
                });
            const step = (job) =>
                request(clients.dh, "/" + job.id, "POST", {
                    action: "step",
                    cursor: job.cursor,
                });
            async function finish(job) {
                let active = await start(job);
                for (let i = 0; i < 1000 && active.state === "running"; i++)
                    active = await step(active);
                assert.equal(active.state, "completed", active.reason);
                return active;
            }
            const count = async (table) =>
                (
                    await db
                        .select({ n: sql`count(*)`.mapWith(Number) })
                        .from(table)
                )[0].n;
            let checks = 0,
                job,
                completed,
                historyId;
            async function check(name, fn) {
                await fn();
                console.log(`PASS IMPORT ${++checks} ${name}`);
            }
            await check(
                "미리보기는 원본·관계·생성/기존 연결을 보여주고 실제 고객 자료는 변경하지 않음",
                async () => {
                    const before = await count(s.crmContacts);
                    job = await preview(input());
                    assert.deepEqual(job.errors, []);
                    assert.equal(job.total, 10);
                    assert.equal(
                        job.rows.find((r) => r.kind === "contacts").operation,
                        "link",
                    );
                    assert.equal(await count(s.crmContacts), before);
                    assert.equal(job.state, "ready");
                    await assert.rejects(
                        request(clients.dh, "/" + job.id, "POST", {
                            action: "start",
                            version: job.version,
                            fingerprint: job.fingerprint,
                        }),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "관리자·읽기/생성/수정·사업/조직 범위와 native 인증 검증",
                async () => {
                    await assert.rejects(
                        request(clients.bo, "/" + job.id),
                        (e) => e.status === 403,
                    );
                    await assert.rejects(
                        request(clients.read, "", "POST", input()),
                        (e) => e.status === 403,
                    );
                    assert.equal(
                        (await request(clients.read, "/" + job.id)).id,
                        job.id,
                    );
                    await db.update(s.organizationMembers).set({ role: "member" }).where(eq(s.organizationMembers.userId, actor.userId));
                    await assert.rejects(
                        imports.importDetail(
                            { ...actor, role: "owner" },
                            job.id,
                            db,
                        ),
                        (e) => e.status === 403,
                    );
                    await db.update(s.organizationMembers).set({ role: "admin" }).where(eq(s.organizationMembers.userId, actor.userId));
                    await assert.rejects(
                        imports.importDetail(otherActor, job.id, db),
                        (e) => e.status === 404,
                    );
                    const { NextRequest } = require("next/server");
                    assert.equal(
                        (
                            await modules["customer-imports"].GET(
                                new NextRequest(
                                    "http://127.0.0.1/api/customer-imports?workspaceId=8",
                                ),
                            )
                        ).status,
                        401,
                    );
                },
            );
            await check(
                "승인 후 고객·회사·딜·업무·다중 과거 상담·메시지가 실제 저장됨",
                async () => {
                    completed = await finish(job);
                    assert.equal(completed.cursor, 10);
                    const contact = await clients.dh.listContacts(8);
                    assert.equal(
                        contact.find((c) => c.id === contacts.dh.id).name,
                        contacts.dh.name,
                    );
                    const results = completed.results;
                    historyId = results.find(
                        (r) =>
                            r.position ===
                            job.rows.find(
                                (p) =>
                                    p.kind === "conversations" &&
                                    p.sourceId === "v1",
                            ).index,
                    ).targetId;
                    const detail = await repo.conversationDetail(
                        actor,
                        historyId,
                        db,
                    );
                    assert.equal(detail.conversation.historyOnly, true);
                    assert.equal(detail.conversation.email, contacts.dh.email);
                    const emptyId = results.find(
                        (r) =>
                            r.position ===
                            job.rows.find(
                                (p) =>
                                    p.kind === "conversations" &&
                                    p.sourceId === "v2",
                            ).index,
                    ).targetId;
                    assert.equal(
                        new Date(
                            (
                                await repo.conversationDetail(
                                    actor,
                                    emptyId,
                                    db,
                                )
                            ).conversation.lastMessageAt,
                        ).toISOString(),
                        date,
                    );
                    assert.equal(
                        detail.messages.filter((m) => m.kind !== "note")[0]
                            .body,
                        "이전 문의",
                    );
                    assert.equal(
                        detail.messages.find((m) => m.body === "이전 공개 답변")
                            .importMetadata.files[0].name,
                        "원본자료.pdf",
                    );
                    assert.equal(detail.conversation.aiState, "human");
                },
            );
            await check(
                "과거 상담은 별도 필터·CRM 활동에 보이고 공개 회원 이력/메모/자동화 발송과 격리",
                async () => {
                    const page = await repo.conversationListPage(
                        actor,
                        channels.dh.id,
                        { filter: "history", status: "open" },
                        undefined,
                        undefined,
                        db,
                    );
                    assert.equal(page.rows.length, 2);
                    assert.ok(page.rows.every((c) => !c.unread));
                    assert.equal(page.counts.history, 2);
                    assert.ok(
                        !(await clients.dh.conversations(channels.dh.id)).some(
                            (c) => c.historyOnly,
                        ),
                    );
                    const identity = await clients.dh.customerIdentity(
                            channels.dh.id,
                            contacts.dh.id,
                        ),
                        data = await repo.visitorDetail(
                            channels.dh.publicKey,
                            identity.identityToken,
                            db,
                        );
                    assert.ok(!JSON.stringify(data).includes("이전 내부"));
                    assert.ok(!JSON.stringify(data).includes("이전 공개 답변"));
                    const activity = await clients.dh.customerActivities(
                        8,
                        contacts.dh.id,
                    );
                    assert.ok(
                        activity.some((a) =>
                            a.summary.includes("이전 공개 답변"),
                        ),
                    );
                    assert.ok(
                        !JSON.stringify(activity).includes("이전 내부 메모"),
                    );
                    await assert.rejects(
                        repo.patchConversation(
                            actor,
                            historyId,
                            { status: "open" },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    await assert.rejects(
                        repo.sendAgentMessage(
                            actor,
                            historyId,
                            {
                                kind: "reply",
                                clientId: randomUUID(),
                                body: "보내지 않음",
                            },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                },
            );
            await check(
                "이전 도중 고객 이벤트/outbox·AI·워크플로를 생성하지 않음",
                async () => {
                    const scopes = await db.select().from(s.platformEvents);
                    assert.ok(
                        !scopes.some(
                            (e) =>
                                JSON.stringify(e.payload).includes(
                                    "이전 첫 상담",
                                ) ||
                                JSON.stringify(e.payload).includes(
                                    "이전 가상 계약",
                                ),
                        ),
                    );
                    assert.equal(await count(s.customerAiJobs), 0);
                    assert.equal(await count(s.customerWorkflowRuns), 0);
                },
            );
            await check(
                "같은 파일 재이전·이미 처리한 단계 재시도는 중복 없이 재사용",
                async () => {
                    const before = await count(s.inboxMessages),
                        again = await preview(input());
                    assert.ok(again.rows.every((r) => r.operation === "reuse"));
                    const saved = await finish(again);
                    await step({ ...saved, cursor: 0 });
                    assert.equal(await count(s.inboxMessages), before);
                },
            );
            await check(
                "미리보기 이후 기존 자료 변경은 시작 전에 차단",
                async () => {
                    const pending = await preview(
                        input({ namespace: "변경 QA" }),
                    );
                    await db
                        .update(s.crmContacts)
                        .set({ name: "검토 후 바뀐 이름" })
                        .where(eq(s.crmContacts.id, contacts.dh.id));
                    await assert.rejects(
                        start(pending),
                        (e) => e.status === 409,
                    );
                    await db
                        .update(s.crmContacts)
                        .set({ name: contacts.dh.name })
                        .where(eq(s.crmContacts.id, contacts.dh.id));
                },
            );
            await check(
                "누락 관계·중복 ID·원본 건수 불일치는 실행 불가",
                async () => {
                    const bad = await preview(
                        input({
                            content: JSON.stringify({
                                contacts: [
                                    {
                                        id: "x",
                                        name: "누락",
                                        companyIds: ["없음"],
                                    },
                                    { id: "x", name: "중복" },
                                ],
                            }),
                            expectedCounts: { contacts: 5 },
                        }),
                    );
                    assert.ok(bad.errors.length >= 3);
                    await assert.rejects(start(bad), (e) => e.status === 409);
                },
            );
            await check(
                "저장 실패는 현재 묶음 전체 롤백·실패 위치 유지·재개",
                async () => {
                    const pending = await preview(
                        input({ namespace: "롤백 QA" }),
                    );
                    let active = await start(pending);
                    const before = await count(s.crmCompanies);
                    await pg.exec(
                        `CREATE FUNCTION qa_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated import failure'; END $$; CREATE TRIGGER qa_import_fail BEFORE INSERT ON customer_import_results FOR EACH ROW EXECUTE FUNCTION qa_import_fail();`,
                    );
                    try {
                        active = await step(active);
                        assert.equal(active.state, "failed");
                        assert.equal(active.cursor, 0);
                        assert.equal(await count(s.crmCompanies), before);
                    } finally {
                        await pg.exec(
                            "DROP TRIGGER qa_import_fail ON customer_import_results; DROP FUNCTION qa_import_fail();",
                        );
                    }
                    active = await request(
                        clients.dh,
                        "/" + active.id,
                        "POST",
                        { action: "resume", version: active.version },
                    );
                    while (active.state === "running")
                        active = await step(active);
                    assert.equal(active.state, "completed", active.reason);
                },
            );
            await check(
                "묶음 진행·중지/재개·취소는 이미 저장된 행과 완료 이력을 보존",
                async () => {
                    const many = await preview(
                        input({
                            namespace: "묶음 QA",
                            content: JSON.stringify({
                                companies: Array.from(
                                    { length: 53 },
                                    (_, i) => ({
                                        id: String(i),
                                        name: "묶음 기업 " + i,
                                    }),
                                ),
                            }),
                        }),
                    );
                    let active = await start(many);
                    active = await step(active);
                    assert.equal(active.cursor, 25);
                    const duplicate = await step({ ...active, cursor: 0 });
                    assert.equal(duplicate.cursor, 25);
                    active = await request(
                        clients.dh,
                        "/" + active.id,
                        "POST",
                        { action: "pause", version: active.version },
                    );
                    assert.equal((await step(active)).cursor, 25);
                    active = await request(
                        clients.dh,
                        "/" + active.id,
                        "POST",
                        { action: "resume", version: active.version },
                    );
                    active = await step(active);
                    assert.equal(active.cursor, 50);
                    active = await request(
                        clients.dh,
                        "/" + active.id,
                        "POST",
                        { action: "cancel", version: active.version },
                    );
                    assert.equal(active.state, "cancelled");
                    assert.equal((await step(active)).cursor, 50);
                },
            );
            await check(
                "가져온 자료 갱신은 명시적 검토가 필요하고 샌드비에서 수정한 값은 보호",
                async () => {
                    const body = {
                        companies: [{ id: "only", name: "처음 이름" }],
                    };
                    await finish(
                        await preview(
                            input({
                                namespace: "갱신 QA",
                                content: JSON.stringify(body),
                            }),
                        ),
                    );
                    body.companies[0].name = "원본 수정";
                    const denied = await preview(
                        input({
                            namespace: "갱신 QA",
                            content: JSON.stringify(body),
                        }),
                    );
                    assert.ok(denied.errors.length);
                    const updated = await finish(
                        await preview(
                            input({
                                namespace: "갱신 QA",
                                content: JSON.stringify(body),
                                updateImported: true,
                            }),
                        ),
                    );
                    const id = updated.results[0].targetId;
                    await db
                        .update(s.crmCompanies)
                        .set({ name: "샌드비에서 수정" })
                        .where(eq(s.crmCompanies.id, id));
                    body.companies[0].name = "원본 재수정";
                    const blocked = await preview(
                        input({
                            namespace: "갱신 QA",
                            content: JSON.stringify(body),
                            updateImported: true,
                        }),
                    );
                    assert.ok(
                        blocked.errors.some((e) =>
                            e.includes("샌드비에서 수정"),
                        ),
                    );
                },
            );
            await check(
                "백오피스랩도 같은 원본 ID를 사업별로 독립 이전",
                async () => {
                    const inputBo = {
                        ...input({
                            namespace: "동일 원본 ID",
                            content: JSON.stringify({
                                contacts: [
                                    { id: "c", name: "백오랩 이전 고객" },
                                ],
                            }),
                        }),
                        workspaceId: 10,
                    };
                    const pending = await request(
                        clients.bo,
                        "",
                        "POST",
                        inputBo,
                    );
                    let active = await request(
                        clients.bo,
                        "/" + pending.id,
                        "POST",
                        {
                            action: "start",
                            version: pending.version,
                            fingerprint: pending.fingerprint,
                            acknowledge: true,
                        },
                    );
                    active = await request(
                        clients.bo,
                        "/" + pending.id,
                        "POST",
                        { action: "step", cursor: 0 },
                    );
                    assert.equal(active.state, "completed");
                    assert.ok(
                        (await clients.bo.listContacts(10)).some(
                            (c) => c.name === "백오랩 이전 고객",
                        ),
                    );
                    assert.ok(
                        !(await clients.dh.listContacts(8)).some(
                            (c) => c.name === "백오랩 이전 고객",
                        ),
                    );
                },
            );
            await check(
                "세 서비스 실제 API 응답 형태를 서버 SDK로 정규화·저장",
                async () => {
                    const datasets = [
                        [
                            "channel",
                            {
                                users: [
                                    {
                                        id: "u",
                                        profile: {
                                            name: "채널톡 가상 고객",
                                            email: "channel-qa@example.test",
                                        },
                                    },
                                ],
                                userChats: [
                                    {
                                        id: "v",
                                        userId: "u",
                                        name: "채널톡 과거 문의",
                                        state: "closed",
                                    },
                                ],
                                messages: [
                                    {
                                        id: "m",
                                        chatId: "v",
                                        personType: "manager",
                                        options: ["private"],
                                        plainText: "채널톡 과거 내부 메모",
                                        createdAt: 1715000000000,
                                    },
                                ],
                            },
                        ],
                        [
                            "intercom",
                            {
                                contacts: [
                                    { id: "u", name: "인터컴 가상 고객" },
                                ],
                                conversations: [
                                    {
                                        id: "v",
                                        created_at: 1715000000,
                                        state: "closed",
                                        contacts: { contacts: [{ id: "u" }] },
                                        source: {
                                            id: "m",
                                            body: "인터컴 과거 문의",
                                            author: {
                                                type: "user",
                                                name: "고객",
                                            },
                                        },
                                        conversation_parts: {
                                            conversation_parts: [],
                                        },
                                    },
                                ],
                            },
                        ],
                        [
                            "hubspot",
                            {
                                companies: {
                                    results: [
                                        {
                                            id: "co",
                                            properties: {
                                                name: "허브스팟 가상 회사",
                                            },
                                        },
                                    ],
                                },
                                contacts: {
                                    results: [
                                        {
                                            id: "u",
                                            properties: {
                                                firstname: "허브스팟",
                                                lastname: "가상 고객",
                                            },
                                            associations: {
                                                companies: {
                                                    results: [{ id: "co" }],
                                                },
                                            },
                                        },
                                    ],
                                },
                                pipelines: {
                                    results: [
                                        {
                                            id: "p",
                                            label: "허브스팟 영업",
                                            stages: [
                                                {
                                                    id: "w",
                                                    label: "계약",
                                                    metadata: {
                                                        isClosed: "true",
                                                        probability: "1.0",
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                                deals: {
                                    results: [
                                        {
                                            id: "d",
                                            properties: {
                                                dealname: "허브스팟 가상 계약",
                                                pipeline: "p",
                                                dealstage: "w",
                                                amount: "120",
                                                deal_currency_code: "USD",
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    ];
                    for (const [source, content] of datasets) {
                        const pending = await clients.dh.previewImport(
                            input({
                                source,
                                namespace: "공식 형태 " + source,
                                content: JSON.stringify(content),
                            }),
                        );
                        assert.deepEqual(pending.errors, []);
                        let active = await clients.dh.changeImport(pending.id, {
                            action: "start",
                            version: pending.version,
                            fingerprint: pending.fingerprint,
                            acknowledge: true,
                        });
                        while (active.state === "running")
                            active = await clients.dh.stepImport(
                                active.id,
                                active.cursor,
                            );
                        assert.equal(active.state, "completed", active.reason);
                        assert.equal(
                            (await clients.dh.import(active.id)).cursor,
                            active.total,
                        );
                    }
                },
            );
            await check(
                "과거 메시지 추가 이전 후에도 원래 시각 순서·100건 커서 보존",
                async () => {
                    const messages = Array.from({ length: 111 }, (_, i) => ({
                        id: "older-" + i,
                        conversationId: "v1",
                        messageKind: "customer",
                        authorName: "원본 고객",
                        body: "추가 과거 문의 " + i,
                        createdAt: new Date(
                            Date.UTC(2020, 0, 1, 0, 0, i),
                        ).toISOString(),
                    }));
                    await finish(
                        await preview(
                            input({ content: JSON.stringify({ messages }) }),
                        ),
                    );
                    const first = await repo.conversationDetail(
                            actor,
                            historyId,
                            db,
                        ),
                        second = await repo.conversationDetail(
                            actor,
                            historyId,
                            db,
                            first.messages[0].id,
                        );
                    assert.equal(first.messages.length, 100);
                    assert.equal(second.messages.length, 14);
                    assert.equal(
                        new Set(
                            [...second.messages, ...first.messages].map(
                                (m) => m.id,
                            ),
                        ).size,
                        114,
                    );
                    assert.equal(first.messages.at(-1).body, "이전 공개 답변");
                    assert.ok(
                        new Date(second.messages.at(-1).createdAt) <=
                            new Date(first.messages[0].createdAt),
                    );
                },
            );
            await check(
                "과거 상담만 가진 회원도 새 웹 상담·비회원 로그인 연결을 별도로 유지",
                async () => {
                    const content = {
                        contacts: [{ id: "c", name: "가상 아카이브 회원" }],
                        conversations: [
                            {
                                id: "archive",
                                contactId: "c",
                                name: "이전 비공개 기록",
                                status: "closed",
                            },
                        ],
                        messages: [
                            {
                                id: "m",
                                conversationId: "archive",
                                messageKind: "customer",
                                authorName: "원본 고객",
                                body: "웹 위젯에 공개하지 않는 이전 문의",
                                createdAt: date,
                            },
                        ],
                    };
                    const saved = await finish(
                            await preview(
                                input({
                                    namespace: "회원 이력 호환 QA",
                                    content: JSON.stringify(content),
                                }),
                            ),
                        ),
                        contactId = saved.results.find(
                            (r) =>
                                r.position ===
                                saved.rows.find((p) => p.kind === "contacts")
                                    .index,
                        ).targetId;
                    const identity = (
                        await clients.dh.customerIdentity(
                            channels.dh.id,
                            contactId,
                        )
                    ).identityToken;
                    assert.equal(
                        (
                            await repo.visitorDetail(
                                channels.dh.publicKey,
                                identity,
                                db,
                            )
                        ).messages.length,
                        0,
                    );
                    await repo.sendVisitorMessage(
                        channels.dh.publicKey,
                        identity,
                        { clientId: randomUUID(), body: "현재 웹 상담" },
                        db,
                    );
                    const anon = await repo.startVisitorSession(
                        channels.dh.publicKey,
                        { name: "로그인 전 방문자" },
                        db,
                    );
                    await repo.sendVisitorMessage(
                        channels.dh.publicKey,
                        anon.token,
                        { clientId: randomUUID(), body: "로그인 전 현재 문의" },
                        db,
                    );
                    await require("../src/lib/inbox/link-identity.ts").linkVisitorIdentity(
                        channels.dh.publicKey,
                        identity,
                        { action: "identify", anonymousToken: anon.token },
                        db,
                    );
                    const actual = await repo.visitorDetail(
                        channels.dh.publicKey,
                        identity,
                        db,
                    );
                    assert.equal(actual.messages.length, 2);
                    const archiveId = saved.results.find(
                            (r) =>
                                r.position ===
                                saved.rows.find(
                                    (p) => p.kind === "conversations",
                                ).index,
                        ).targetId,
                        proof = "a".repeat(64);
                    await db
                        .update(s.inboxConversations)
                        .set({
                            tokenHash: require("node:crypto")
                                .createHash("sha256")
                                .update(proof)
                                .digest("hex"),
                        })
                        .where(eq(s.inboxConversations.id, archiveId));
                    await assert.rejects(
                        require("../src/lib/inbox/link-identity.ts").linkVisitorIdentity(
                            channels.dh.publicKey,
                            identity,
                            { action: "identify", anonymousToken: proof },
                            db,
                        ),
                        (e) => e.status === 409,
                    );
                    assert.ok(
                        !JSON.stringify(actual).includes(
                            "웹 위젯에 공개하지 않는",
                        ),
                    );
                },
            );
            console.log(
                `고객 데이터 이전 SQL/API QA: ${checks}개 통과. 실제 원본 서비스·고객·외부 발송 0건.`,
            );
            if (extra) await extra({ ...ctx, imports, importJob: completed });
            else await pg.close();
        },
    );
}
if (require.main === module)
    runImportCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runImportCheck };
