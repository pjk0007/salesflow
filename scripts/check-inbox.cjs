/* eslint-disable @typescript-eslint/no-require-imports -- 격리된 가상 고객 SQL 검사 */
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    { randomUUID } = require("node:crypto");
const { PGlite } = require(
    path.resolve(
        __dirname,
        "../.testenv/test-runtime/node_modules/@electric-sql/pglite",
    ),
);
const Module = require("node:module"),
    originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
    return name === "@electric-sql/pglite"
        ? require.resolve(
              path.resolve(
                  __dirname,
                  "../.testenv/test-runtime/node_modules/@electric-sql/pglite",
              ),
          )
        : originalResolve.call(this, name, ...args);
};
const { drizzle } = require("drizzle-orm/pglite"),
    { PgDialect, getTableConfig } = require("drizzle-orm/pg-core"),
    { SQL } = require("drizzle-orm");
Module._resolveFilename = originalResolve;
process.env.DATABASE_URL =
    "postgresql://isolated:isolated@127.0.0.1:1/isolated";
process.env.JWT_SECRET = "isolated-inbox-test-only-not-a-real-key";
const schema = require("../src/lib/db/schema.ts");
const repo = require("../src/lib/inbox/repository.ts"),
    rules = require("../src/lib/inbox/rules.ts"),
    { loadInboxJourney } = require("../src/lib/inbox/journey.ts");
const org = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002",
    user = "00000000-0000-4000-8000-000000000003",
    outsider = "00000000-0000-4000-8000-000000000004";
const actor = { orgId: org, userId: user, name: "가상 효정", role: "admin" },
    otherActor = {
        orgId: other,
        userId: outsider,
        name: "다른 조직",
        role: "admin",
    };
function ddl(table) {
    const c = getTableConfig(table),
        dialect = new PgDialect();
    const literal = (v) =>
        typeof v === "boolean" || typeof v === "number"
            ? String(v)
            : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
    return `CREATE TABLE "${c.name}" (${c.columns.map((col) => `"${col.name}" ${col.getSQLType()}${col.primary ? " PRIMARY KEY" : ""}${col.notNull ? " NOT NULL" : ""}${col.default === undefined ? "" : ` DEFAULT ${col.default instanceof SQL ? dialect.sqlToQuery(col.default).sql : literal(col.default)}`}`).join(",")})`;
}
async function fixture() {
    const pg = new PGlite();
    await pg.waitReady;
    for (const table of [
        schema.organizations,
        schema.users,
        schema.organizationMembers,
        schema.workspaces,
        schema.partitions,
        schema.records,
        schema.apiTokens,
        schema.apiTokenScopes,
        schema.aiCopyKnowledgeVersions,
        schema.aiUsageLogs,
        schema.aiUsageQuotas,
        schema.aiCopyGenerationJobs,
        schema.emailSendLogs,
        schema.emailCopyExperiments,
        schema.emailCopyAssignments,
    ])
        await pg.exec(ddl(table));
    await pg.exec('CREATE UNIQUE INDEX qa_ai_usage_month ON ai_usage_quotas(org_id,month)');
    for (const migration of [
        "0088_customer_inbox.sql",
        "0089_customer_platform.sql",
        "0090_customer_sales.sql",
        "0091_customer_activities.sql",
        "0092_inbox_files_audit.sql",
        "0093_platform_webhooks.sql",
        "0094_customer_ai_support.sql",
        "0095_customer_workflows.sql",
        "0096_inbox_identity_link.sql",
        "0097_customer_imports.sql",
        "0098_inbox_email.sql",
        "0099_inbox_email_files.sql",
        "0100_inbox_google_connection.sql",
        "0101_inbox_operations.sql",
        "0102_customer_workspace_access.sql",
    ])
        for (const statement of fs
            .readFileSync(
                path.resolve(__dirname, "../drizzle", migration),
                "utf8",
            )
            .split("--> statement-breakpoint"))
            if (statement.trim()) await pg.exec(statement);
    const db = drizzle(pg, { schema });
    await db.insert(schema.organizations).values([
        { id: org, name: "가상 디자이너하이어", slug: "fake-dh" },
        { id: other, name: "가상 타 조직", slug: "fake-other" },
    ]);
    await db.insert(schema.users).values([
        {
            id: user,
            orgId: org,
            name: actor.name,
            email: "staff@example.test",
            password: "test-only",
        },
        {
            id: outsider,
            orgId: other,
            name: otherActor.name,
            email: "other@example.test",
            password: "test-only",
        },
    ]);
    await db.insert(schema.organizationMembers).values([
        { organizationId: org, userId: user, role: "admin" },
        { organizationId: other, userId: outsider, role: "admin" },
    ]);
    await db.insert(schema.workspaces).values([
        { id: 8, orgId: org, name: "디자이너하이어 (가상)" },
        { id: 9, orgId: other, name: "타 조직" },
        { id: 10, orgId: org, name: "백오피스랩 (가상)" },
    ]);
    await db.insert(schema.partitions).values([
        { id: 8, workspaceId: 8, name: "가상 고객" },
        { id: 10, workspaceId: 10, name: "다른 사업" },
    ]);
    await db.insert(schema.records).values([
        {
            id: 1,
            orgId: org,
            workspaceId: 8,
            partitionId: 8,
            integratedCode: "TEST001",
            data: {
                name: "가상 베스트피스 · 류민호",
                email: "ryu@example.test",
            },
        },
        {
            id: 2,
            orgId: org,
            workspaceId: 10,
            partitionId: 10,
            integratedCode: "TEST002",
            data: {},
        },
    ]);
    const conn=async(strings,...params)=>(await pg.query(strings.reduce((s,p,i)=>s+p+(i<params.length?`$${i+1}`:""),""),params)).rows;
    conn.release=()=>{};
    return { pg, db, actor, otherActor,queryClient:{reserve:async()=>conn},conn };
}
async function runCheck(extra) {
    const ctx = await fixture(),
        { pg, db } = ctx;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("실제 네트워크 사용 금지");
    };
    let checks = 0;
    async function check(name, action) {
        await action();
        console.log(`PASS ${++checks} ${name}`);
    }
    try {
        const config = {
            workspaceId: 8,
            name: "디자이너하이어",
            greeting: "안녕하세요. 편하게 문의를 남겨주세요.",
            color: "#635BFF",
            allowedOrigins: ["http://127.0.0.1:3120"],
            enabled: true,
        };
        const channel = await repo.saveChannel(actor, config, db);
        const channelOther = await repo.saveChannel(
            otherActor,
            { ...config, workspaceId: 9 },
            db,
        );
        const session = await repo.startVisitorSession(
            channel.publicKey,
            {
                name: "가상 베스트피스 · 류민호",
                email: "ryu@example.test",
                pageUrl: "http://127.0.0.1:3120/pricing?email=private",
            },
            db,
        );
        const m = {
            clientId: randomUUID(),
            body: "디자인 구독 가격을 알고 싶어요.",
        };
        await check("실제 SQL 마이그레이션과 스키마 컬럼 일치", async () => {
            for (const table of [
                schema.inboxChannels,
                schema.inboxConversations,
                schema.inboxMessages,
                schema.inboxReads,
            ]) {
                const config = getTableConfig(table);
                const rows = (
                    await pg.query(
                        "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                        [config.name],
                    )
                ).rows;
                assert.deepEqual(
                    rows.map((r) => r.column_name).sort(),
                    config.columns.map((c) => c.name).sort(),
                );
            }
        });
        await check("고객 문의 저장과 담당자 수신함 미확인", async () => {
            await repo.sendVisitorMessage(
                channel.publicKey,
                session.token,
                m,
                db,
            );
            assert.equal(
                (await repo.listConversations(actor, channel.id, db))[0].unread,
                true,
            );
        });
        await check(
            "중복 제출은 하나의 메시지 · customerSeq 보존",
            async () => {
                await repo.sendVisitorMessage(
                    channel.publicKey,
                    session.token,
                    m,
                    db,
                );
                const detail = await repo.conversationDetail(
                    actor,
                    session.id,
                    db,
                );
                assert.equal(detail.messages.length, 1);
                assert.equal(detail.conversation.customerSeq, 1);
            },
        );
        await check("같은 clientId에 다른 본문은 409", () =>
            assert.rejects(
                repo.sendVisitorMessage(
                    channel.publicKey,
                    session.token,
                    { ...m, body: "다른 내용" },
                    db,
                ),
                (e) => e.status === 409,
            ),
        );
        await check("내부 메모는 방문자 응답과 미리보기에서 제외", async () => {
            await repo.sendAgentMessage(
                actor,
                session.id,
                {
                    kind: "note",
                    body: "고객에게 비공개인 내부 메모",
                    clientId: randomUUID(),
                },
                db,
            );
            const data = await repo.visitorDetail(
                channel.publicKey,
                session.token,
                db,
            );
            assert.equal(data.messages.length, 1);
            assert.ok(!JSON.stringify(data).includes("내부 메모"));
            assert.equal(
                (await repo.listConversations(actor, channel.id, db))[0]
                    .preview,
                m.body,
            );
        });
        await check("상담원 답변은 방문자에게 전달", async () => {
            await repo.sendAgentMessage(
                actor,
                session.id,
                {
                    kind: "reply",
                    body: "안녕하세요. 필요한 디자인 업무를 알려주시면 안내드릴게요.",
                    clientId: randomUUID(),
                },
                db,
            );
            assert.equal(
                (await repo.visitorDetail(channel.publicKey, session.token, db))
                    .messages.length,
                2,
            );
        });
        await check(
            "내가 확인한 순번만 읽음 처리 · 늦게 온 문의 유지",
            async () => {
                await repo.sendVisitorMessage(
                    channel.publicKey,
                    session.token,
                    { body: "추가 문의입니다.", clientId: randomUUID() },
                    db,
                );
                await repo.markRead(actor, session.id, 1, db);
                assert.equal(
                    (await repo.listConversations(actor, channel.id, db))[0]
                        .unread,
                    true,
                );
                await repo.markRead(actor, session.id, 2, db);
                await repo.markRead(actor, session.id, 1, db);
                assert.equal(
                    (await repo.listConversations(actor, channel.id, db))[0]
                        .unread,
                    false,
                );
            },
        );
        await check("보류 후 고객 재문의는 자동 재개", async () => {
            await repo.patchConversation(
                actor,
                session.id,
                { status: "snoozed" },
                db,
            );
            await repo.sendVisitorMessage(
                channel.publicKey,
                session.token,
                { body: "다시 문의해요.", clientId: randomUUID() },
                db,
            );
            assert.equal(
                (await repo.conversationDetail(actor, session.id, db))
                    .conversation.status,
                "open",
            );
        });
        await check("종료 상담 답변 차단 · 고객 재문의는 재개", async () => {
            await repo.patchConversation(
                actor,
                session.id,
                { status: "closed" },
                db,
            );
            await assert.rejects(
                repo.sendAgentMessage(
                    actor,
                    session.id,
                    {
                        kind: "reply",
                        body: "차단 대상",
                        clientId: randomUUID(),
                    },
                    db,
                ),
            );
            await repo.sendVisitorMessage(
                channel.publicKey,
                session.token,
                { body: "재문의입니다.", clientId: randomUUID() },
                db,
            );
            assert.equal(
                (await repo.conversationDetail(actor, session.id, db))
                    .conversation.status,
                "open",
            );
        });
        await check("타 조직 상담과 다른 채널의 세션은 접근 불가", async () => {
            await assert.rejects(
                repo.conversationDetail(otherActor, session.id, db),
                (e) => e.status === 404,
            );
            await assert.rejects(
                repo.visitorDetail(channelOther.publicKey, session.token, db),
                (e) => e.status === 401,
            );
            await assert.rejects(
                repo.visitorDetail(channel.publicKey, "0".repeat(64), db),
                (e) => e.status === 401,
            );
            await assert.rejects(repo.listConversations(otherActor, channel.id, db), e => e.status === 404);
        });
        await check("담당자는 같은 조직의 활성 팀원", async () => {
            await assert.rejects(
                repo.patchConversation(
                    actor,
                    session.id,
                    { assigneeId: outsider },
                    db,
                ),
            );
            await repo.patchConversation(
                actor,
                session.id,
                {
                    assigneeId: user,
                    priority: true,
                    tags: ["도입문의", "도입문의"],
                },
                db,
            );
            const chat = (await repo.conversationDetail(actor, session.id, db))
                .conversation;
            assert.equal(chat.assigneeId, user);
            assert.deepEqual(chat.tags, ["도입문의"]);
        });
        await check(
            "확인된 같은 사업의 CRM 고객만 연결 · 여정에서 메모 제외",
            async () => {
                await assert.rejects(
                    repo.patchConversation(
                        actor,
                        session.id,
                        { recordId: 2 },
                        db,
                    ),
                );
                await repo.patchConversation(
                    actor,
                    session.id,
                    { recordId: 1 },
                    db,
                );
                const events = await loadInboxJourney(org, [1], db);
                assert.ok(events.length >= 3);
                assert.ok(events.every((e) => e.type !== "chat_note"));
                assert.deepEqual(await loadInboxJourney(other, [1], db), []);
            },
        );
        await check(
            "고객 입력 이메일은 자동 CRM 매칭 안 함 · 페이지 쿼리 제거",
            async () => {
                const s = await repo.startVisitorSession(
                    channel.publicKey,
                    {
                        name: "다른 방문자",
                        email: "ryu@example.test",
                        pageUrl: "http://127.0.0.1:3120/plan?secret=x",
                    },
                    db,
                );
                const chat = (await repo.conversationDetail(actor, s.id, db))
                    .conversation;
                assert.equal(chat.recordId, null);
                assert.equal(chat.pageUrl, "http://127.0.0.1:3120/plan");
            },
        );
        await check(
            "세션 복구와 토큰 해시 저장 · 응답에 해시 없음",
            async () => {
                assert.equal(
                    (
                        await repo.startVisitorSession(
                            channel.publicKey,
                            { name: "다른 이름", token: session.token },
                            db,
                        )
                    ).id,
                    session.id,
                );
                const raw = (
                    await pg.query(
                        "SELECT token_hash FROM inbox_conversations WHERE id=$1",
                        [session.id],
                    )
                ).rows[0];
                assert.notEqual(raw.token_hash, session.token);
                assert.ok(
                    !JSON.stringify(
                        await repo.conversationDetail(actor, session.id, db),
                    ).includes("tokenHash"),
                );
            },
        );
        await check(
            "메시지 길이·빈 입력 검증 · 허용 도메인만 저장",
            async () => {
                await assert.rejects(
                    repo.sendVisitorMessage(
                        channel.publicKey,
                        session.token,
                        { body: " ", clientId: randomUUID() },
                        db,
                    ),
                );
                assert.equal(
                    rules.safePageUrl(
                        "javascript:alert(1)",
                        config.allowedOrigins,
                    ),
                    null,
                );
                assert.equal(
                    rules.safePageUrl(
                        "https://other.test/path",
                        config.allowedOrigins,
                    ),
                    null,
                );
                assert.throws(() =>
                    rules.normalizeOrigins(["https://example.test/path"]),
                );
                await assert.rejects(
                    repo.saveChannel(
                        actor,
                        { ...config, allowedOrigins: [] },
                        db,
                    ),
                );
            },
        );
        await check(
            "관리자만 상담창 설정 · 타 조직 워크스페이스 차단",
            async () => {
                await db.update(schema.organizationMembers).set({ role: "member" }).where(require("drizzle-orm").eq(schema.organizationMembers.userId, actor.userId));
                await assert.rejects(
                    repo.saveChannel({ ...actor, role: "owner" }, config, db),
                    (e) => e.status === 403,
                );
                await db.update(schema.organizationMembers).set({ role: "admin" }).where(require("drizzle-orm").eq(schema.organizationMembers.userId, actor.userId));
                await assert.rejects(
                    repo.saveChannel(actor, { ...config, workspaceId: 9 }, db),
                    (e) => e.status === 404,
                );
            },
        );
        await check("DB 기준 메시지 제한과 재시도 보존", async () => {
            const s = await repo.startVisitorSession(
                channel.publicKey,
                { name: "빈도 시험" },
                db,
            );
            const input = { body: "빈도 시험", clientId: randomUUID() };
            await repo.sendVisitorMessage(
                channel.publicKey,
                s.token,
                input,
                db,
            );
            for (let n = 1; n < 20; n++)
                await repo.sendVisitorMessage(
                    channel.publicKey,
                    s.token,
                    { ...input, clientId: randomUUID() },
                    db,
                );
            await assert.rejects(
                repo.sendVisitorMessage(
                    channel.publicKey,
                    s.token,
                    { ...input, clientId: randomUUID() },
                    db,
                ),
                (e) => e.status === 429,
            );
            await repo.sendVisitorMessage(
                channel.publicKey,
                s.token,
                input,
                db,
            );
        });
        await check("꺼진 상담창은 공개 세션과 메시지 차단", async () => {
            await repo.saveChannel(actor, { ...config, enabled: false }, db);
            await assert.rejects(
                repo.publicChannel(channel.publicKey, db),
                (e) => e.status === 404,
            );
            await repo.saveChannel(actor, config, db);
        });
        await check(
            "같은 시각의 상담이 100건을 넘어도 다음 페이지에서 누락 없음",
            async () => {
                const stamp = new Date("2025-01-01T00:00:00Z");
                await db.insert(schema.inboxConversations).values(
                    Array.from({ length: 110 }, (_, i) => ({
                        channelId: channel.id,
                        orgId: org,
                        tokenHash: String(i).padStart(64, "0"),
                        name: "페이지 시험",
                        lastMessageAt: stamp,
                    })),
                );
                const page = await repo.listConversations(
                        actor,
                        channel.id,
                        db,
                    ),
                    last = page.at(-1);
                const next = await repo.listConversations(
                    actor,
                    channel.id,
                    db,
                    last.lastMessageAt,
                    last.id,
                );
                assert.equal(
                    new Set([...page, ...next].map((c) => c.id)).size,
                    113,
                );
            },
        );
        await check("첫 100건 밖의 과거 대화 본문도 전체 검색", async () => {
            const [old] = await db
                .insert(schema.inboxConversations)
                .values({
                    orgId: org,
                    channelId: channel.id,
                    tokenHash: "f".repeat(64),
                    name: "과거 검색 고객",
                    preview: "최근 내용",
                    lastMessageAt: new Date("2020-01-01"),
                })
                .returning();
            await db
                .insert(schema.inboxMessages)
                .values({
                    conversationId: old.id,
                    clientId: randomUUID(),
                    kind: "customer",
                    body: "오래된 검색 전용 문장",
                    authorName: "가상 고객",
                });
            assert.ok(
                !(await repo.listConversations(actor, channel.id, db)).some(
                    (c) => c.id === old.id,
                ),
            );
            const result = await repo.conversationListPage(
                actor,
                channel.id,
                { q: "오래된 검색 전용 문장", status: "open" },
                undefined,
                undefined,
                db,
            );
            assert.deepEqual(
                result.rows.map((c) => c.id),
                [old.id],
            );
            assert.equal(result.counts.all, 1);
            await assert.rejects(repo.conversationListPage(otherActor, channel.id, { q: "오래된 검색 전용 문장" }, undefined, undefined, db), e => e.status === 404);
        });
        await check(
            "검색의 %·_는 전체 일치 문법이 아닌 문자로 처리",
            async () => {
                await db
                    .insert(schema.inboxConversations)
                    .values(
                        ["문자%_시험", "문자XX시험"].map((name, i) => ({
                            orgId: org,
                            channelId: channel.id,
                            tokenHash: ("e" + i).repeat(32),
                            name,
                        })),
                    );
                const result = await repo.listConversations(
                    actor,
                    channel.id,
                    db,
                    undefined,
                    undefined,
                    { q: "문자%_시험" },
                );
                assert.equal(result.length, 1);
                assert.equal(result[0].name, "문자%_시험");
            },
        );
        await check(
            "전체 검색 결과의 상태·내 담당·중요·안 읽음 집계",
            async () => {
                const [open, closed] = await db
                    .insert(schema.inboxConversations)
                    .values([
                        {
                            orgId: org,
                            channelId: channel.id,
                            tokenHash: "d".repeat(64),
                            name: "집계 전용 열림",
                            assigneeId: actor.userId,
                            priority: true,
                            customerSeq: 2,
                        },
                        {
                            orgId: org,
                            channelId: channel.id,
                            tokenHash: "c".repeat(64),
                            name: "집계 전용 종료",
                            status: "closed",
                        },
                    ])
                    .returning();
                const result = await repo.conversationListPage(
                    actor,
                    channel.id,
                    { q: "집계 전용", status: "open", filter: "mine" },
                    undefined,
                    undefined,
                    db,
                );
                assert.deepEqual(
                    result.rows.map((c) => c.id),
                    [open.id],
                );
                assert.deepEqual(result.counts, {
                    all: 1,
                    history: 0,
                    mine: 1,
                    unassigned: 0,
                    unread: 1,
                    priority: 1,
                });
                await repo.markRead(actor, open.id, 2, db);
                assert.equal(
                    (
                        await repo.conversationListPage(
                            actor,
                            channel.id,
                            {
                                q: "집계 전용",
                                status: "open",
                                filter: "unread",
                            },
                            undefined,
                            undefined,
                            db,
                        )
                    ).rows.length,
                    0,
                );
                assert.deepEqual(
                    (
                        await repo.listConversations(
                            actor,
                            channel.id,
                            db,
                            undefined,
                            undefined,
                            { q: "집계 전용", status: "closed" },
                        )
                    ).map((c) => c.id),
                    [closed.id],
                );
            },
        );
        console.log(
            `고객 상담 SQL QA: ${checks}개 통과. 실제 고객/외부 전송 0건.`,
        );
        global.fetch = originalFetch;
        if (extra) {
            await pg.exec(
                "TRUNCATE inbox_messages, inbox_reads, inbox_conversations RESTART IDENTITY CASCADE",
            );
            await extra({ ...ctx, channel, repo });
        } else await pg.close();
    } finally {
        global.fetch = originalFetch;
    }
}
if (require.main === module)
    runCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runCheck, fixture };
