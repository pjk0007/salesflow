/* eslint-disable @typescript-eslint/no-require-imports -- 실제 외부 전송 없는 격리 API/SQL 검증 */
const assert = require("node:assert/strict"),
    Module = require("node:module"),
    { randomUUID, randomBytes } = require("node:crypto");
const { fixture } = require("./check-inbox.cjs");
async function runPlatformCheck(extra) {
    const ctx = await fixture(),
        { db, pg, actor } = ctx,
        schema = require("../src/lib/db/schema.ts");
    const keys = {
        dh: randomBytes(32).toString("hex"),
        bo: randomBytes(32).toString("hex"),
        read: randomBytes(32).toString("hex"),
        expired: randomBytes(32).toString("hex"),
    };
    for (const [index, name] of Object.keys(keys).entries()) {
        await db.insert(schema.apiTokens).values({
            id: index + 1,
            orgId: actor.orgId,
            createdBy: actor.userId,
            name: "가상 API " + name,
            token: keys[name],
            ...(name === "expired"
                ? { expiresAt: new Date("2020-01-01") }
                : {}),
        });
        await db.insert(schema.apiTokenScopes).values({
            tokenId: index + 1,
            scopeType: "workspace",
            scopeId: name === "bo" ? 10 : 8,
            permissions: {
                read: true,
                create: name !== "read",
                update: name !== "read",
                delete: false,
            },
        });
    }
    ctx.aiTest = { configured: false, deps: null };
    const originalLoad = Module._load;
    Module._load = function (name, parent, isMain) {
        const resolved = Module._resolveFilename(
            name,
            parent,
            isMain,
        ).replaceAll("\\", "/");
        if (resolved.endsWith("/src/lib/db/index.ts"))
            return { ...schema, db, queryClient: ctx.queryClient };
        if (resolved.endsWith("/src/lib/customer-ai/runtime.ts"))
            return {
                supportDeps: () =>
                    ctx.aiTest.deps ?? {
                        now: () => new Date(),
                        quota: async () => true,
                        call: async () => {
                            throw new Error("QA model not configured");
                        },
                    },
            };
        if (resolved.endsWith("/src/lib/ai/client.ts")) {
            const actual = originalLoad.apply(this, arguments);
            return {
                ...actual,
                getAiClient: (id) =>
                    ctx.aiTest.configured
                        ? { provider: "claude", model: id }
                        : actual.getAiClient(id),
            };
        }
        return originalLoad.apply(this, arguments);
    };
    for (const name of Object.keys(require.cache))
        if (
            /\/src\/lib\/(inbox|customer-platform|customer-ai|customer-workflows|customer-imports|inbox-email|inbox-operations)\//.test(
                name.replaceAll("\\", "/"),
            )
        )
            delete require.cache[name];
    const routeDefinitions = [
        [/^\/api\/inbox-notifications$/,()=>"inbox-notifications"],
        [/^\/api\/inbox-operations\/channels\/(\d+)$/,()=>"inbox-operations/channels/[id]"],
        [/^\/api\/inbox-operations\/reports$/,()=>"inbox-operations/reports"],
        [/^\/api\/inbox-operations\/conversations\/([a-f0-9-]+)$/,()=>"inbox-operations/conversations/[id]"],
        [/^\/api\/v1\/support\/notifications$/,()=>"v1/support/notifications"],
        [/^\/api\/v1\/support\/channels\/(\d+)\/settings$/,()=>"v1/support/channels/[id]/settings"],
        [/^\/api\/v1\/support\/reports$/,()=>"v1/support/reports"],
        [/^\/api\/v1\/support\/conversations\/([a-f0-9-]+)$/,()=>"v1/support/conversations/[id]"],

        [/^\/api\/email-mailboxes\/([a-f0-9-]+)\/google$/, () => "email-mailboxes/[id]/google"],
        [/^\/api\/email-google\/callback$/, () => "email-google/callback"],
        [/^\/api\/email-files\/([a-f0-9-]+)$/, () => "email-files/[id]"],
        [/^\/api\/v1\/email\/receipts\/([a-f0-9-]+)\/files$/, () => "v1/email/receipts/[id]/files"],
        [/^\/api\/v1\/email\/files\/([a-f0-9-]+)$/, () => "v1/email/files/[id]"],
        [/^\/api\/v1\/email\/mailboxes\/([a-f0-9-]+)\/files$/, () => "v1/email/mailboxes/[id]/files"],
        [/^\/api\/v1\/email\/deliveries\/([a-f0-9-]+)\/files\/([a-f0-9-]+)$/, () => "v1/email/deliveries/[id]/files/[fileId]"],
        [/^\/api\/email-mailboxes$/, () => "email-mailboxes"],
        [/^\/api\/email-mailboxes\/([a-f0-9-]+)$/, () => "email-mailboxes/[id]"],
        [/^\/api\/email-deliveries\/([a-f0-9-]+)$/, () => "email-deliveries/[id]"],
        [/^\/api\/v1\/email\/mailboxes$/, () => "v1/email/mailboxes"],
        [/^\/api\/v1\/email\/mailboxes\/([a-f0-9-]+)$/, () => "v1/email/mailboxes/[id]"],
        [/^\/api\/v1\/email\/mailboxes\/([a-f0-9-]+)\/(receive|claim)$/, m => `v1/email/mailboxes/[id]/${m[2]}`],
        [/^\/api\/v1\/email\/deliveries\/([a-f0-9-]+)$/, () => "v1/email/deliveries/[id]"],
        [/^\/api\/v1\/imports$/, () => "v1/imports"],
        [/^\/api\/v1\/imports\/([a-f0-9-]+)$/, () => "v1/imports/[id]"],
        [/^\/api\/v1\/workflows$/, () => "v1/workflows"],
        [/^\/api\/v1\/workflows\/events$/, () => "v1/workflows/events"],
        [/^\/api\/v1\/workflows\/([a-f0-9-]+)$/, () => "v1/workflows/[id]"],
        [
            /^\/api\/v1\/workflows\/([a-f0-9-]+)\/runs$/,
            () => "v1/workflows/[id]/runs",
        ],
        [
            /^\/api\/v1\/workflows\/([a-f0-9-]+)\/runs\/([a-f0-9-]+)$/,
            () => "v1/workflows/[id]/runs/[runId]",
        ],
        [
            /^\/api\/v1\/support-ai\/(settings|knowledge)$/,
            (m) => `v1/support-ai/${m[1]}`,
        ],
        [
            /^\/api\/v1\/support-ai\/knowledge\/(\d+)$/,
            () => "v1/support-ai/knowledge/[id]",
        ],
        [
            /^\/api\/v1\/inbox\/conversations\/([a-f0-9-]+)\/ai$/,
            () => "v1/inbox/conversations/[id]/ai",
        ],
        [
            /^\/api\/v1\/inbox\/conversations\/([a-f0-9-]+)\/ai\/([a-f0-9-]+)$/,
            () => "v1/inbox/conversations/[id]/ai/[runId]",
        ],
        [/^\/api\/v1\/webhooks$/, () => "v1/webhooks"],
        [/^\/api\/v1\/webhooks\/([a-f0-9-]+)$/, () => "v1/webhooks/[id]"],
        [
            /^\/api\/v1\/webhooks\/([a-f0-9-]+)\/deliveries$/,
            () => "v1/webhooks/[id]/deliveries",
        ],
        [
            /^\/api\/v1\/webhook-deliveries\/([a-f0-9-]+)$/,
            () => "v1/webhook-deliveries/[id]",
        ],
        [
            /^\/api\/v1\/inbox\/conversations\/([a-f0-9-]+)\/(attachments|audit)$/,
            (m) => `v1/inbox/conversations/[id]/${m[2]}`,
        ],
        [
            /^\/api\/v1\/inbox\/attachments\/([a-f0-9-]+)$/,
            () => "v1/inbox/attachments/[id]",
        ],
        [
            /^\/api\/messenger\/([a-f0-9]+)\/attachments\/([a-f0-9-]+)$/,
            () => "messenger/[key]/attachments/[id]",
        ],
        [
            /^\/api\/messenger\/([a-f0-9]+)\/attachments$/,
            () => "messenger/[key]/attachments",
        ],
        [/^\/api\/v1\/crm\/(contacts|companies)$/, (m) => "v1/crm/" + m[1]],
        [
            /^\/api\/v1\/crm\/contacts\/([a-f0-9-]+)\/events$/,
            () => "v1/crm/contacts/[id]/events",
        ],
        [
            /^\/api\/v1\/inbox\/(channels|sessions|conversations)$/,
            (m) => "v1/inbox/" + m[1],
        ],
        [
            /^\/api\/v1\/inbox\/conversations\/([a-f0-9-]+)$/,
            () => "v1/inbox/conversations/[id]",
        ],
        [/^\/api\/messenger\/([a-f0-9]+)$/, () => "messenger/[key]"],
        [
            /^\/api\/v1\/crm\/(pipelines|deals|tasks)$/,
            () => "v1/crm/[resource]",
        ],
        [
            /^\/api\/v1\/crm\/(pipelines|deals|tasks)\/([a-f0-9-]+)$/,
            () => "v1/crm/[resource]/[id]",
        ],
        [
            /^\/api\/v1\/crm\/contacts\/([a-f0-9-]+)\/activity$/,
            () => "v1/crm/contacts/[id]/activity",
        ],
    ];
    const routes = routeDefinitions.map(([pattern, file]) => ({
        pattern,
        file,
    }));
    const filenames = [
        "inbox-notifications",
        "inbox-operations/channels/[id]",
        "inbox-operations/reports",
        "inbox-operations/conversations/[id]",
        "v1/support/notifications",
        "v1/support/channels/[id]/settings",
        "v1/support/reports",
        "v1/support/conversations/[id]",

        "email-mailboxes/[id]/google", "email-google/callback",
        "email-files/[id]", "v1/email/receipts/[id]/files", "v1/email/files/[id]", "v1/email/mailboxes/[id]/files", "v1/email/deliveries/[id]/files/[fileId]",
        "email-mailboxes", "email-mailboxes/[id]", "email-deliveries/[id]", "v1/email/mailboxes", "v1/email/mailboxes/[id]", "v1/email/mailboxes/[id]/receive", "v1/email/mailboxes/[id]/claim", "v1/email/deliveries/[id]",
        "v1/imports", "v1/imports/[id]", "customer-imports", "customer-imports/[id]",
        "v1/workflows",
        "v1/workflows/events",
        "v1/workflows/[id]",
        "v1/workflows/[id]/runs",
        "v1/workflows/[id]/runs/[runId]",
        "customer-workflows",
        "customer-workflows/events",
        "customer-workflows/[id]",
        "customer-workflows/[id]/runs",
        "customer-workflows/[id]/runs/[runId]",
        "v1/support-ai/settings",
        "v1/support-ai/knowledge",
        "v1/support-ai/knowledge/[id]",
        "customer-ai/settings",
        "customer-ai/knowledge",
        "customer-ai/knowledge/[id]",
        "v1/inbox/conversations/[id]/ai",
        "v1/inbox/conversations/[id]/ai/[runId]",
        "inbox/conversations/[id]/ai",
        "inbox/conversations/[id]/ai/[runId]",
        "v1/webhooks",
        "v1/webhooks/[id]",
        "v1/webhooks/[id]/deliveries",
        "v1/webhook-deliveries/[id]",
        "customer-platform/webhooks",
        "customer-platform/webhooks/[id]",
        "customer-platform/webhooks/[id]/deliveries",
        "customer-platform/webhook-deliveries/[id]",
        "customer-platform/webhooks-config",
        "v1/inbox/conversations/[id]/attachments",
        "v1/inbox/conversations/[id]/audit",
        "v1/inbox/attachments/[id]",
        "messenger/[key]/attachments",
        "messenger/[key]/attachments/[id]",
        "inbox/conversations/[id]/attachments",
        "inbox/conversations/[id]/audit",
        "inbox/attachments/[id]",
        "inbox/channels/[id]/audit",
        "v1/crm/contacts",
        "v1/crm/companies",
        "v1/crm/contacts/[id]/events",
        "v1/inbox/channels",
        "v1/inbox/sessions",
        "v1/inbox/conversations",
        "v1/inbox/conversations/[id]",
        "messenger/[key]",
        "v1/crm/[resource]",
        "v1/crm/[resource]/[id]",
        "v1/crm/contacts/[id]/activity",
        "inbox/conversations/[id]/customer",
        "customer-crm/contacts/[id]/activity",
    ];
    const modules = Object.fromEntries(
        filenames.map((name) => [
            name,
            require("../src/app/api/" + name + "/route.ts"),
        ]),
    );
    const repo = require("../src/lib/inbox/repository.ts"),
        platform = require("../src/lib/customer-platform/repository.ts"),
        { getUserFromNextRequest } = require("../src/lib/auth.ts"),
        { NextRequest } = require("next/server"),
        {
            SendbClient,
            createMemberIdentityHandler,
        } = require("../sdk/server.ts");
    Module._load = originalLoad;
    async function dispatch(input, init = {}) {
        const url = new URL(typeof input === "string" ? input : input.url),
            definition = routes.find((r) => r.pattern.test(url.pathname));
        if (!definition)
            return Response.json(
                { success: false, error: "not found" },
                { status: 404 },
            );
        const match = url.pathname.match(definition.pattern),
            mod = modules[definition.file(match)],
            handler = mod[init.method || "GET"];
        if (!handler)
            return Response.json(
                { success: false, error: "method not allowed" },
                { status: 405 },
            );
        const request = new NextRequest(url, {
            ...init,
            headers: new Headers(init.headers),
        });
        return handler(request, {
            params: Promise.resolve({
                id: definition.file(match).includes("[resource]")
                    ? match[2]
                    : definition
                            .file(match)
                            .includes("messenger/[key]/attachments/[id]")
                      ? match[2]
                      : match[1],
                fileId: match[2],
                runId: match[2],
                key: match[1],
                resource: match[1],
            }),
        });
    }
    const clients = Object.fromEntries(
        Object.entries(keys).map(([name, apiToken]) => [
            name,
            new SendbClient({
                apiBase: "http://127.0.0.1:3120",
                apiToken,
                fetchImpl: dispatch,
            }),
        ]),
    );
    const config = {
        name: "디자이너하이어",
        workspaceId: 8,
        greeting: "가상 상담입니다.",
        color: "#635BFF",
        allowedOrigins: ["http://127.0.0.1:3122"],
        enabled: true,
    };
    const dh = await clients.dh.request(
            "/api/v1/inbox/channels",
            "POST",
            config,
        ),
        bo = await clients.bo.request("/api/v1/inbox/channels", "POST", {
            ...config,
            workspaceId: 10,
            name: "백오피스랩",
            allowedOrigins: ["http://127.0.0.1:3123"],
        });
    let checks = 0;
    async function check(name, fn) {
        await fn();
        console.log(`PASS ${++checks} ${name}`);
    }
    try {
        await check("서버 SDK의 API 토큰은 직렬화되지 않음", async () =>
            assert.equal(JSON.stringify(clients.dh), "{}"),
        );
        await check(
            "API 토큰 없음·만료·읽기전용·다른 사업 권한 검증",
            async () => {
                assert.equal(
                    (
                        await dispatch(
                            "http://127.0.0.1:3120/api/v1/crm/contacts?workspaceId=8",
                        )
                    ).status,
                    401,
                );
                await assert.rejects(
                    clients.expired.listContacts(8),
                    (e) => e.status === 401,
                );
                await assert.rejects(
                    clients.bo.listContacts(8),
                    (e) => e.status === 403,
                );
                await assert.rejects(
                    clients.read.upsertContact({
                        workspaceId: 8,
                        externalId: "blocked",
                        name: "차단",
                    }),
                    (e) => e.status === 403,
                );
            },
        );
        const company = await clients.dh.upsertCompany({
            workspaceId: 8,
            externalId: "company-1",
            name: "가상 기업",
            attributes: { industry: "design" },
        });
        const contact = await clients.dh.upsertContact({
            workspaceId: 8,
            externalId: "member-1",
            name: "가상 디하 회원 A",
            email: "member@example.test",
            companyIds: [company.id],
            recordId: 1,
            attributes: { plan: "basic" },
        });
        const boContact = await clients.bo.upsertContact({
            workspaceId: 10,
            externalId: "member-1",
            name: "가상 백오랩 회원 A",
        });
        await check(
            "같은 외부 회원 ID는 사업별로 구분 · 멱등 upsert와 속성 보존",
            async () => {
                assert.notEqual(contact.id, boContact.id);
                const again = await clients.dh.upsertContact({
                    workspaceId: 8,
                    externalId: "member-1",
                    name: contact.name,
                    attributes: { source: "api" },
                });
                assert.equal(again.id, contact.id);
                assert.equal(again.attributes.plan, "basic");
                assert.equal(again.attributes.source, "api");
                assert.deepEqual(again.companyIds, [company.id]);
            },
        );
        await check("타 사업의 회사와 CRM 레코드 관계는 차단", async () => {
            await assert.rejects(
                clients.bo.upsertContact({
                    workspaceId: 10,
                    externalId: "bad-company",
                    name: "차단",
                    companyIds: [company.id],
                }),
                (e) => e.status === 400,
            );
            await assert.rejects(
                clients.bo.upsertContact({
                    workspaceId: 10,
                    externalId: "bad-record",
                    name: "차단",
                    recordId: 1,
                }),
                (e) => e.status === 400,
            );
        });
        const identity = await clients.dh.customerIdentity(dh.id, contact.id),
            identity2 = await clients.dh.customerIdentity(dh.id, contact.id);
        const other = await clients.dh.upsertContact({
                workspaceId: 8,
                externalId: "member-2",
                name: "가상 디하 회원 B",
            }),
            otherIdentity = await clients.dh.customerIdentity(dh.id, other.id);
        const messenger = (
            key,
            identityToken,
            method = "GET",
            body,
            origin = "http://127.0.0.1:3122",
        ) =>
            dispatch("http://127.0.0.1:3120/api/messenger/" + key, {
                method,
                headers: {
                    Origin: origin,
                    ...(identityToken
                        ? { Authorization: "Bearer " + identityToken }
                        : {}),
                    "Content-Type": "application/json",
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        await check(
            "회원 인증 발급·초기 조회만으로 수신함에 빈 상담을 만들지 않음",
            async () => {
                const response = await messenger(
                        dh.publicKey,
                        identity.identityToken,
                    ),
                    result = await response.json();
                assert.equal(response.status, 200);
                assert.equal(result.data.profile.name, contact.name);
                assert.equal(result.data.messages.length, 0);
                assert.equal((await clients.dh.conversations(dh.id)).length, 0);
                assert.equal(
                    getUserFromNextRequest(
                        new NextRequest("http://127.0.0.1", {
                            headers: {
                                Authorization:
                                    "Bearer " + identity.identityToken,
                            },
                        }),
                    ),
                    null,
                );
            },
        );
        const message = {
            clientId: randomUUID(),
            body: "회원 A의 가상 도입 문의",
        };
        await messenger(dh.publicKey, identity.identityToken, "POST", message);
        const conversation = (await clients.dh.conversations(dh.id))[0];
        await check(
            "회원별 이력·기기 변경 복구·다른 계정 이력 격리",
            async () => {
                const a = (
                        await (
                            await messenger(
                                dh.publicKey,
                                identity2.identityToken,
                            )
                        ).json()
                    ).data,
                    b = (
                        await (
                            await messenger(
                                dh.publicKey,
                                otherIdentity.identityToken,
                            )
                        ).json()
                    ).data;
                assert.equal(a.messages[0].body, message.body);
                assert.equal(b.messages.length, 0);
                assert.equal(conversation.contactId, contact.id);
                assert.equal(conversation.recordId, 1);
                assert.equal(
                    (
                        await messenger(
                            bo.publicKey,
                            identity.identityToken,
                            "GET",
                            null,
                            "http://127.0.0.1:3123",
                        )
                    ).status,
                    401,
                );
            },
        );
        await check(
            "서비스 API 답변·비공개 메모 · 고객 응답에서 메모 제외",
            async () => {
                await clients.dh.reply(
                    conversation.id,
                    "서버 API 답변",
                    randomUUID(),
                );
                await clients.dh.reply(
                    conversation.id,
                    "팀 전용 내부 메모",
                    randomUUID(),
                    "note",
                );
                const result = (
                    await (
                        await messenger(dh.publicKey, identity.identityToken)
                    ).json()
                ).data;
                assert.equal(result.messages.length, 2);
                assert.ok(!JSON.stringify(result).includes("팀 전용"));
                await assert.rejects(
                    clients.bo.reply(conversation.id, "차단", randomUUID()),
                    (e) => e.status === 403,
                );
            },
        );
        await check(
            "headless API CORS는 등록된 사업 사이트만 허용",
            async () => {
                const response = await messenger(dh.publicKey, null, "OPTIONS");
                assert.equal(
                    response.headers.get("access-control-allow-origin"),
                    "http://127.0.0.1:3122",
                );
                const denied = await messenger(
                    dh.publicKey,
                    identity.identityToken,
                    "GET",
                    null,
                    "https://unregistered.example",
                );
                assert.equal(denied.status, 403);
                assert.equal(
                    denied.headers.get("access-control-allow-origin"),
                    null,
                );
            },
        );
        await check(
            "서버/브라우저 이벤트 연결과 이벤트 ID 재사용 충돌 검증",
            async () => {
                const event = {
                    eventId: randomUUID(),
                    name: "plan_viewed",
                    properties: { plan: "pro" },
                    occurredAt: "2026-10-14T00:00:00Z",
                };
                await clients.dh.track(8, contact.id, event);
                await clients.dh.track(8, contact.id, event);
                const rows = await clients.dh.request(
                    `/api/v1/crm/contacts/${contact.id}/events?workspaceId=8`,
                );
                assert.equal(rows.length, 1);
                await assert.rejects(
                    clients.dh.track(8, other.id, event),
                    (e) => e.status === 409,
                );
                const web = await messenger(
                    dh.publicKey,
                    identity.identityToken,
                    "POST",
                    {
                        action: "track",
                        eventId: randomUUID(),
                        name: "signup_started",
                    },
                );
                assert.equal(web.status, 200);
                assert.equal((await web.json()).data.contactId, contact.id);
            },
        );
        await check(
            "사이트 인증 핸들러는 브라우저 본문의 회원 ID를 신뢰하지 않음",
            async () => {
                const handler = createMemberIdentityHandler({
                    client: clients.dh,
                    workspaceId: 8,
                    channelId: dh.id,
                    authenticate: async () => ({
                        id: "member-1",
                        name: contact.name,
                    }),
                });
                const response = await handler(
                    new Request("http://127.0.0.1:3122/api/chat-identity", {
                        method: "POST",
                        body: JSON.stringify({ id: "member-2" }),
                        headers: { Origin: "http://127.0.0.1:3122" },
                    }),
                );
                const value = await response.json();
                const result = (
                    await (
                        await messenger(dh.publicKey, value.data.identityToken)
                    ).json()
                ).data;
                assert.equal(result.profile.name, contact.name);
                assert.equal(result.messages.length, 2);
            },
        );
        await check(
            "유효한 회원 서명 없이 이메일·고객 ID로 기존 이력을 가져올 수 없음",
            async () => {
                const anonymous = await messenger(dh.publicKey, null, "POST", {
                    action: "session",
                    name: "익명",
                    email: "member@example.test",
                    contactId: contact.id,
                });
                const value = await anonymous.json();
                const result = (
                    await (
                        await messenger(dh.publicKey, value.data.token)
                    ).json()
                ).data;
                assert.equal(result.profile.identified, false);
                assert.equal(result.messages.length, 0);
            },
        );
        console.log(
            `고객 플랫폼 API QA: ${checks}개 통과. 실제 외부 전송 0건.`,
        );
        if (extra)
            await extra({
                ...ctx,
                keys,
                channels: { dh, bo },
                contacts: { dh: contact, bo: boContact },
                clients,
                dispatch,
                modules,
                routeDefinitions,
                repo,
                platform,
            });
        else await pg.close();
    } catch (error) {
        await pg.close();
        throw error;
    } finally {
        Module._load = originalLoad;
    }
}
if (require.main === module)
    runPlatformCheck().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
module.exports = { runPlatformCheck };
