/* eslint-disable @typescript-eslint/no-require-imports -- 가상 고객의 격리 DB·실제 API 검사 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { eq } = require("drizzle-orm");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
const runJourneyCheck = process.argv.includes("--postgres")
    ? require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck
    : runPlatformCheck;
runJourneyCheck(async ctx => {
    const { db, pg, actor, otherActor, channels, contacts, repo, dispatch } = ctx;
    const s = require("../src/lib/db/schema.ts");
    const journey = require("../src/lib/inbox-journey/repository.ts");
    const { issueJourneyContext } = require("../src/lib/inbox-journey/context.ts");
    let checks = 0;
    const check = async (name, fn) => { await fn(); checks++; console.log("PASS " + name); };
    await pg.exec('CREATE UNIQUE INDEX qa_tracker_visitor ON tracker_visitors(site_id,visitor_id); CREATE UNIQUE INDEX qa_tracker_session ON tracker_sessions(site_id,session_key)');
    const [site] = await db.insert(s.trackerSites).values({ orgId: actor.orgId, workspaceId: 8,
        name: "가상 사이트", apiKey: "fictional-tracker-key", domains: ["127.0.0.1"], matchField: "uid" }).returning();
    const [visitor] = await db.insert(s.trackerVisitors).values({ orgId: actor.orgId, siteId: site.id, visitorId: randomUUID(), recordId: 1 }).returning();
    const [send] = await db.insert(s.emailSendLogs).values({ orgId: actor.orgId, recordId: 1,
        recipientEmail: "fake@example.test", subject: "가상 도입 안내", status: "sent" }).returning();
    const clickId = randomUUID();
    await db.insert(s.emailClickLogs).values({ orgId: actor.orgId, sendLogId: send.id, url: "http://127.0.0.1:3122/service", clickId });
    await db.insert(s.alimtalkSendLogs).values({ orgId: actor.orgId, recordId: 1, senderKey: "fake", templateCode: "fake", recipientNo: "01000000000", status: "sent" });
    const [session] = await db.insert(s.trackerSessions).values({ siteId: site.id, visitorId: visitor.id, sessionKey: randomUUID(), clickId,
        landingPage: "http://127.0.0.1:3122/service", startedAt: new Date("2026-10-15T09:00:00Z"), endedAt: new Date("2026-10-15T09:01:10Z"), duration: 70, pageCount: 2 }).returning();
    for (const [index, path] of ["/service", "/pricing"].entries()) await db.insert(s.trackerEvents).values({ siteId: site.id, visitorId: visitor.id, sessionId: session.id,
        eventType: "PAGE_VIEW", pageUrl: `http://127.0.0.1:3122${path}`, pageTitle: path, occurredAt: new Date(`2026-10-15T09:00:${index ? "40" : "00"}Z`) });
    const anonymous = await repo.startVisitorSession(channels.dh.publicKey, { name: "가상 방문 문의", email: contacts.dh.email }, db);
    await repo.sendVisitorMessage(channels.dh.publicKey, anonymous.token, { clientId: randomUUID(), body: "가상 도입 질문" }, db);
    const contextValue = { orgId: actor.orgId, workspaceId: 8, siteId: site.id, visitorId: visitor.id, sessionId: session.id, origin: "http://127.0.0.1:3122" };
    const token = issueJourneyContext(contextValue);
    const member = await ctx.clients.dh.upsertContact({ workspaceId: 8, externalId: "journey-member",
        name: "가상 경로 회원", email: contacts.dh.email });
    await check("메일 수신 리드·메일/알림톡·방문·현재 문의를 유입 근거로 조회하며 고객 자동 병합 없음", async () => {
        assert.equal((await journey.attachJourneyContext(channels.dh.publicKey, anonymous.token, { journeyToken: token }, db)).linked, true);
        const result = await journey.conversationJourney(actor, anonymous.id, db);
        assert.equal(result.status, "attributed"); assert.equal(result.record.id, 1);
        for (const type of ["email_sent", "email_click", "alimtalk_sent", "session", "chat_customer"]) assert.ok(result.events.some(e => e.type === type), type);
        assert.match(result.events.find(e => e.type === "session").label, /^사이트 방문 · 페이지·행동 /);
        const [chat] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, anonymous.id));
        assert.equal(chat.recordId, null); assert.equal(chat.contactId, null);
        assert.ok(!JSON.stringify(await repo.visitorDetail(channels.dh.publicKey, anonymous.token, db)).includes("fictional-tracker-key"));
    });
    await check("중복 경로 연결은 상담·메시지를 다시 만들지 않음", async () => {
        await journey.attachJourneyContext(channels.dh.publicKey, anonymous.token, { journeyToken: token }, db);
        assert.equal((await db.select().from(s.inboxMessages).where(eq(s.inboxMessages.conversationId, anonymous.id))).length, 1);
    });
    await check("변조·만료 증명과 다른 사업·다른 직원은 경로 접근 거부", async () => {
        assert.equal((await journey.attachJourneyContext(channels.dh.publicKey, anonymous.token, { journeyToken: token + "x" }, db)).linked, false);
        assert.equal((await journey.attachJourneyContext(channels.dh.publicKey, anonymous.token, { journeyToken: issueJourneyContext(contextValue, new Date("2020-01-01")) }, db)).linked, false);
        await assert.rejects(journey.attachJourneyContext(channels.bo.publicKey, anonymous.token, { journeyToken: token }, db));
        await assert.rejects(journey.conversationJourney(otherActor, anonymous.id, db));
    });
    await check("이메일만 일치하는 회원은 기존 리드에 연결하지 않음", async () => {
        await ctx.clients.dh.customerIdentity(channels.dh.id, member.id);
        const [row] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, member.id));
        assert.equal(row.recordId, null);
    });
    await check("확인된 회원 externalId와 설정한 uid의 유일 일치만 자동 연결", async () => {
        await db.update(s.records).set({ data: { name: "가상 기존 리드", uid: member.externalId } }).where(eq(s.records.id, 1));
        await ctx.clients.dh.customerIdentity(channels.dh.id, member.id);
        const [linked] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, member.id));
        assert.equal(linked.recordId, 1);
        await ctx.clients.dh.customerIdentity(channels.dh.id, member.id);
        const [repeat] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, member.id));
        assert.equal(repeat.version, linked.version);
    });
    await check("중복 uid 후보는 임의로 첫 고객을 연결하지 않음", async () => {
        const duplicate = await ctx.clients.dh.upsertContact({ workspaceId: 8, externalId: "duplicate-uid", name: "가상 중복 회원" });
        for (const id of [3, 4]) await db.insert(s.records).values({ id, orgId: actor.orgId, workspaceId: 8, partitionId: 8, integratedCode: `JOURNEY${id}`, data: { name: `가상 리드 ${id}`, uid: duplicate.externalId } });
        await ctx.clients.dh.customerIdentity(channels.dh.id, duplicate.id);
        const [row] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, duplicate.id));
        assert.equal(row.recordId, null);
    });
    await check("같은 CRM 고객에 매핑된 과거 상담은 공개 대화만 여정에 포함하고 원본 연결은 수정하지 않음", async () => {
        const oldId = randomUUID();
        await db.insert(s.inboxConversations).values({ id: oldId, channelId: channels.dh.id, orgId: actor.orgId,
            contactId: member.id, tokenHash: "e".repeat(64), historyOnly: true, isCurrent: false,
            name: "가상 과거 상담", status: "closed" });
        for (const [kind, body] of [["reply", "PAST_PUBLIC_JOURNEY"], ["note", "PAST_PRIVATE_JOURNEY"]])
            await db.insert(s.inboxMessages).values({ conversationId: oldId, orgId: actor.orgId, clientId: randomUUID(), kind, body, authorName: "가상 원본 상담원" });
        const result = await journey.conversationJourney(actor, anonymous.id, db);
        assert.ok(JSON.stringify(result).includes("PAST_PUBLIC_JOURNEY"));
        assert.ok(!JSON.stringify(result).includes("PAST_PRIVATE_JOURNEY"));
        const [unchanged] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, oldId));
        assert.equal(unchanged.recordId, null); assert.equal(unchanged.historyOnly, true);
    });
    await check("공유 링크 수신 대상과 확인된 리드가 다르면 다른 리드 발송 기록을 섞지 않음", async () => {
        const current = await repo.ownedConversation(actor, anonymous.id, db);
        await repo.patchConversation(actor, anonymous.id, { recordId: 3, version: current.version }, db);
        const result = await journey.conversationJourney(actor, anonymous.id, db);
        assert.equal(result.record.id, 3); assert.equal(result.conflict, true);
        assert.ok(!result.events.some(e => e.type === "email_sent"));
    });
    await check("고객이 확인한 리드 연결은 상담 이력에 반영되고 메모는 여정에서 제외", async () => {
        const current = await repo.ownedConversation(actor, anonymous.id, db);
        await repo.patchConversation(actor, anonymous.id, { recordId: 1, version: current.version }, db);
        await repo.sendAgentMessage(actor, anonymous.id, { kind: "note", clientId: randomUUID(), body: "PRIVATE_JOURNEY_NOTE" }, db);
        const result = await journey.conversationJourney(actor, anonymous.id, db);
        assert.equal(result.status, "confirmed"); assert.ok(!JSON.stringify(result).includes("PRIVATE_JOURNEY_NOTE"));
    });
    await check("확인된 CRM 고객의 딜·업무·이벤트가 전체 경로에 포함되고 다른 사업 활동과 상담 복제 로그는 제외", async () => {
        for (const [source, action, summary] of [["deal", "updated", "가상 계약 검토"], ["task", "done", "가상 견적 전달"], ["event", "form.submitted", "가상 신청 완료"], ["conversation", "customer", "DUPLICATE_CHAT_ACTIVITY"]]) {
            await db.insert(s.crmActivities).values({ orgId: actor.orgId, workspaceId: 8, contactId: member.id, source, action, summary, entityId: member.id, eventKey: randomUUID(), metadata: { stage: { name: "가상 협의 단계" } } });
        }
        await db.insert(s.crmActivities).values({ orgId: actor.orgId, workspaceId: 9, contactId: member.id, source: "event", action: "event", summary: "OTHER_WORKSPACE_ACTIVITY", entityId: member.id, eventKey: randomUUID() });
        const result = await journey.conversationJourney(actor, anonymous.id, db);
        for (const type of ["crm_deal_updated", "crm_task_done", "crm_event_form.submitted"]) assert.ok(result.events.some(e => e.type === type), type);
        assert.equal(result.events.find(e => e.type === "crm_deal_updated").meta.stageName, "가상 협의 단계");
        assert.ok(!JSON.stringify(result).includes("OTHER_WORKSPACE_ACTIVITY"));
        assert.ok(!JSON.stringify(result).includes("DUPLICATE_CHAT_ACTIVITY"));
    });
    await check("리드 번호가 없는 확인된 CRM 고객도 과거 상담과 CRM 활동을 볼 수 있음", async () => {
        const { issueCustomerIdentity } = require("../src/lib/customer-platform/identity.ts");
        const known = await repo.startVisitorSession(channels.dh.publicKey, { name: "가상 CRM 전용" }, db);
        const standalone = await ctx.clients.dh.upsertContact({ workspaceId: 8, externalId: "crm-only-timeline", name: "가상 CRM 전용" });
        const { linkVisitorIdentity } = require("../src/lib/inbox/link-identity.ts");
        await linkVisitorIdentity(channels.dh.publicKey, issueCustomerIdentity(standalone.id, channels.dh.publicKey).identityToken, { action: "identify", anonymousToken: known.token }, db);
        await db.insert(s.crmActivities).values({ orgId: actor.orgId, workspaceId: 8, contactId: standalone.id, source: "event", action: "signup", summary: "CRM_ONLY_SIGNUP", entityId: standalone.id, eventKey: randomUUID() });
        const result = await journey.conversationJourney(actor, known.id, db);
        assert.equal(result.record, null);
        assert.ok(result.events.some(e => e.label === "CRM_ONLY_SIGNUP"));
        assert.ok(!JSON.stringify(result).includes("가상 계약 검토"));
    });
    await check("실제 tracker 수집 API가 경로 증명을 반환", async () => {
        const collect = ctx.modules["tracker/collect"];
        const { NextRequest } = require("next/server");
        const response = await collect.POST(new NextRequest("http://localhost:3120/api/tracker/collect?key=fictional-tracker-key", {
            method: "POST", headers: { origin: contextValue.origin, "content-type": "application/json" },
            body: JSON.stringify({ visitor_id: visitor.visitorId, session_key: session.sessionKey,
                event: { type: "PAGE_VIEW", page_url: "http://127.0.0.1:3122/next" } }),
        }));
        assert.equal(response.status, 200); const value = await response.json(); assert.equal(typeof value.journey_context, "string");
    });
    await check("직원용 실제 경로 API는 인증을 확인하고 현재 상담의 여정을 반환", async () => {
        const { NextRequest } = require("next/server");
        const { generateToken } = require("../src/lib/auth.ts");
        const handler = ctx.modules["inbox/conversations/[id]/journey"];
        const context = { params: Promise.resolve({ id: anonymous.id }) };
        assert.equal((await handler.GET(new NextRequest("http://localhost:3120/"), context)).status, 401);
        const response = await handler.GET(new NextRequest("http://localhost:3120/", { headers: { authorization: `Bearer ${generateToken(actor)}` } }), context);
        assert.equal(response.status, 200); assert.equal((await response.json()).data.status, "confirmed");
    });
    await check("비회원→기존 회원 상담 병합도 최근 방문 경로를 유지", async () => {
        const { issueCustomerIdentity } = require("../src/lib/customer-platform/identity.ts");
        const { linkVisitorIdentity } = require("../src/lib/inbox/link-identity.ts");
        const source = await repo.startVisitorSession(channels.dh.publicKey, { name: "가상 이어진 방문" }, db);
        await journey.attachJourneyContext(channels.dh.publicKey, source.token, { journeyToken: token }, db);
        const result = await linkVisitorIdentity(channels.dh.publicKey, issueCustomerIdentity(contacts.dh.id, channels.dh.publicKey).identityToken, { action: "identify", anonymousToken: source.token }, db);
        const [chat] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, result.id));
        assert.equal(chat.journeyContext.sessionId, session.id);
    });
    await check("가상 체험 API는 운영에서 거절하고 dev의 고정 체험 사업에만 멱등 자료 준비", async () => {
        const { NextRequest } = require("next/server");
        const { generateToken } = require("../src/lib/auth.ts");
        const previous = process.env.NEXT_PUBLIC_APP_URL;
        const dev = "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app";
        const request = mode => new NextRequest("http://0.0.0.0:3000/api/inbox-journey/demo", { method: "POST", headers: { origin: dev,
            authorization: `Bearer ${generateToken(actor)}`, "content-type": "application/json" }, body: JSON.stringify({ mode }) });
        try {
            process.env.NEXT_PUBLIC_APP_URL = "https://production.example.test";
            assert.equal((await ctx.modules["inbox-journey/demo"].POST(request())).status, 404);
            process.env.NEXT_PUBLIC_APP_URL = dev;
            assert.equal((await ctx.modules["inbox-journey/demo"].POST(request())).status, 404);
            await db.insert(s.workspaces).values({ id: 19, orgId: actor.orgId, name: "샌드비 상담 체험 2026-10-15" });
            await repo.saveChannel(actor, { workspaceId: 19, name: "가상 체험 상담", greeting: "가상 안내", color: "#635BFF", allowedOrigins: [dev], enabled: true }, db);
            await pg.exec("SELECT setval(pg_get_serial_sequence('records','id'), (SELECT max(id) FROM records))");
            const first = await ctx.modules["inbox-journey/demo"].POST(request());
            assert.equal(first.status, 200); const a = (await first.json()).data;
            const second = await ctx.modules["inbox-journey/demo"].POST(request());
            assert.equal(second.status, 200); const b = (await second.json()).data;
            assert.equal(a.recordId, b.recordId); assert.equal(a.clickId, b.clickId);
            const logs = await db.select().from(s.emailSendLogs).where(eq(s.emailSendLogs.recordId, a.recordId));
            assert.equal(logs.length, 1); assert.equal(logs[0].status, "demo");
            const memberResponse = await ctx.modules["inbox-journey/demo"].POST(request("member"));
            assert.equal(memberResponse.status, 200); assert.equal(typeof (await memberResponse.json()).data.identityToken, "string");
        } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previous; }
    });
    void dispatch;
    console.log(`리드→방문→상담 QA: ${checks}개 통과. 실제 고객·외부 전송 0건.`);
    await pg.close();
}).catch(error => { console.error(error); process.exitCode = 1; });
