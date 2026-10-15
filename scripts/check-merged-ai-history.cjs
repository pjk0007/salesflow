/* eslint-disable @typescript-eslint/no-require-imports -- Memory PGlite, real routes/SDK and fictional model responses only. */
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
const BASE = "http://127.0.0.1:3120";
const AT = new Date("2020-01-02T03:04:05.000Z");
const terminalStates = ["sent", "failed", "cancelled", "handed_off", "stale"];

async function messenger(ctx, channel, token, body, expected = 200) {
    const response = await ctx.dispatch(`${BASE}/api/messenger/${channel.publicKey}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value.data;
}
async function nativeAi(ctx, conversationId, { runId, before, method = "GET", body, who = ctx.actor, cookie, expected = 200 } = {}) {
    const { NextRequest } = require("next/server");
    const { generateToken } = require("../src/lib/auth.ts");
    const url = `${BASE}/api/inbox/conversations/${conversationId}/ai${runId ? `/${runId}` : ""}${before ? `?before=${encodeURIComponent(before)}` : ""}`;
    const request = new NextRequest(url, { method, headers: { Cookie: cookie ?? `token=${generateToken({ ...who, email: "fictional-staff@example.test" })}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    // The shared checker loads these real native handlers but dispatches only service AI paths.
    const route = ctx.modules[`inbox/conversations/[id]/ai${runId ? "/[runId]" : ""}`];
    const response = await route[method](request, { params: Promise.resolve({ id: conversationId, runId }) });
    const value = await response.json();
    assert.equal(response.status, expected, `native ${method} ${url}: ${JSON.stringify(value)}`);
    return value.data;
}
async function seededRows(ctx, ids) {
    const s = require("../src/lib/db/schema.ts"), { inArray, asc } = require("drizzle-orm");
    if (!ids.length) return { jobs: [], calls: [] };
    return {
        jobs: await ctx.db.select().from(s.customerAiJobs).where(inArray(s.customerAiJobs.id, ids)).orderBy(asc(s.customerAiJobs.id)),
        calls: await ctx.db.select().from(s.customerAiCalls).where(inArray(s.customerAiCalls.jobId, ids)).orderBy(asc(s.customerAiCalls.id)),
    };
}

/** Shared only by fictional route and panel QA; never connects to a server or model. */
async function seedMergedAiHistory(ctx, selection = {}) {
    const options = typeof selection === "string" ? { business: selection } : selection;
    const business = options.business ?? "dh", large = options.large !== false, scopeFixtures = options.scopeFixtures !== false;
    assert.ok(["dh", "bo"].includes(business));
    const { db, actor, clients, channels, aiTest } = ctx;
    const s = require("../src/lib/db/schema.ts"), { eq } = require("drizzle-orm");
    const { SendbMessengerClient } = require("../sdk/messenger.ts");
    const client = clients[business], channel = channels[business], workspaceId = channel.workspaceId;
    const fact = "가상 디자인 구독은 월 150,000원이며 작업 요청은 3개까지 가능합니다.";
    let modelCalls = 0;
    aiTest.configured = true;
    aiTest.deps = {
        now: () => new Date(Date.now() + 20_000), quota: async () => true, timeoutMs: 100,
        call: async (_config, prompt) => {
            modelCalls++;
            const input = JSON.parse(prompt.user);
            return { content: JSON.stringify(input.answer ? { supported: true, confidence: 0.98, unsupportedClaims: [] } : { decision: "answer", answer: fact, confidence: 0.98, reason: "가상 승인 근거", citations: [{ sourceId: input.sources[0].id, quote: input.sources[0].text }] }), promptTokens: 100, completionTokens: 30, truncated: false };
        },
    };
    const knowledge = await client.createSupportKnowledge(workspaceId, `가상 ${business} 병합 이력 QA 지식`, { businessName: `가상 ${business}`, claims: [{ text: fact, sourceUrl: "https://example.test/fictional-support-faq", checkedAt: new Date(Date.now() - 1000).toISOString(), purposes: ["customer_chat"] }] });
    await client.reviewSupportKnowledge(workspaceId, knowledge.id, "approve");
    const catalog = await client.supportAiSettings(workspaceId);
    const settingsResult = await client.updateSupportAiSettings(workspaceId, { ...catalog.settings, mode: "manual", knowledgeVersionId: knowledge.id, handoffAssigneeId: actor.userId });
    const settings = settingsResult.settings ?? settingsResult;
    const contact = await client.upsertContact({ workspaceId, externalId: `fictional-merged-history-${randomUUID()}`, name: `허구 ${business} 병합 회원 A` });
    const token = (await client.customerIdentity(channel.id, contact.id)).identityToken;
    const sdk = new SendbMessengerClient({ apiBase: BASE, channelKey: channel.publicKey, getToken: () => token, fetchImpl: ctx.dispatch });
    const member = await sdk.createConversation({ clientId: randomUUID(), body: "가상 디자인 구독 요금을 문의합니다." });
    const current = { id: member.conversationId, token, sdk, contactId: contact.id, messageId: member.id };
    async function anonymous(which = channel, name = "허구 로그인 전 문의") {
        const session = await messenger(ctx, which, null, { action: "session", name });
        const message = await messenger(ctx, which, session.token, { clientId: randomUUID(), body: "로그인 전 가상 디자인 구독 요금 문의입니다." });
        return { ...session, messageId: message.id, channel: which };
    }
    const sources = [await anonymous(), await anonymous()];
    const expectedCallsByJob = new Map(), expectedJobIds = [], excludedJobIds = [], activeBefore = [], terminalBefore = [];
    function jobValues(chat, state, extra = {}) {
        return { id: randomUUID(), orgId: chat.channel?.orgId ?? actor.orgId, workspaceId: chat.channel?.workspaceId ?? workspaceId, conversationId: chat.id, clientId: randomUUID(), sourceMessageId: chat.messageId, lastPublicId: chat.messageId, mode: "manual", settingsVersion: settings.version, settingsSnapshot: settings, knowledgeVersionId: knowledge.id, sources: [], context: { messages: [], question: "허구 보존용 질문", hasAttachment: false }, state, answer: `허구 ${state} 과거 응답`, reason: `허구 ${state} 보존 이력`, createdAt: AT, updatedAt: AT, ...extra };
    }
    async function addJob(chat, state, { include = true, extra = {} } = {}) {
        const values = jobValues(chat, state, extra);
        const [row] = await db.insert(s.customerAiJobs).values(values).returning();
        const leaseId = randomUUID();
        const calls = await db.insert(s.customerAiCalls).values(["draft", "verify"].map((stage, index) => ({ id: randomUUID(), jobId: row.id, leaseId, stage, state: "succeeded", provider: "fictional-provider", model: "fictional-model-no-network", promptTokens: 11 + index, completionTokens: 7 + index, startedAt: AT, finishedAt: new Date(AT.getTime() + 1000) }))).returning();
        expectedCallsByJob.set(row.id, calls.sort((a, b) => b.id.localeCompare(a.id)));
        (include ? expectedJobIds : excludedJobIds).push(row.id);
        return row;
    }
    for (const [index, source] of sources.entries()) {
        const amount = large ? (index === 0 ? 67 : 13) : (index === 0 ? 5 : 3);
        for (let i = 0; i < amount; i++) terminalBefore.push(await addJob(source, terminalStates[i % terminalStates.length]));
    }
    for (const state of ["queued", "generating", "ready"]) activeBefore.push(await addJob(sources[0], state, { extra: { leaseId: randomUUID(), leaseUntil: new Date(Date.now() + 60000) } }));
    for (let i = 0; i < (large ? 35 : 2); i++) await addJob(current, terminalStates[i % terminalStates.length]);
    for (const source of sources) {
        const linked = await messenger(ctx, channel, token, { action: "identify", anonymousToken: source.token });
        assert.equal(linked.id, current.id); assert.equal(linked.merged, true);
    }
    for (const previous of terminalBefore) {
        const [after] = await db.select().from(s.customerAiJobs).where(eq(s.customerAiJobs.id, previous.id));
        assert.deepEqual(after, previous, "Actual identity merge must preserve terminal job rows");
    }
    for (const previous of activeBefore) {
        const [after] = await db.select().from(s.customerAiJobs).where(eq(s.customerAiJobs.id, previous.id));
        assert.equal(after.state, "stale"); assert.equal(after.conversationId, previous.conversationId); assert.equal(after.createdAt.getTime(), previous.createdAt.getTime());
        assert.equal(after.leaseId, null); assert.equal(after.leaseUntil, null);
    }
    // Legacy ready is deliberately inserted after the real merge, to test read-only
    // handling of an old ready row without depending on today's merge invalidation.
    const oldReady = await addJob(sources[0], "ready");
    // Explicit same-member sources are supported as well as null anonymous contacts.
    await db.update(s.inboxConversations).set({ contactId: contact.id }).where(eq(s.inboxConversations.id, sources[1].id));
    if (scopeFixtures) {
        const otherMember = await client.upsertContact({ workspaceId, externalId: `fictional-other-member-${randomUUID()}`, name: "허구 회원 B" });
        const unrelated = await anonymous();
        await addJob(unrelated, "sent", { include: false });
        const wrongMember = await anonymous();
        await db.update(s.inboxConversations).set({ mergedIntoId: current.id, contactId: otherMember.id, status: "closed", isCurrent: false }).where(eq(s.inboxConversations.id, wrongMember.id));
        await addJob(wrongMember, "sent", { include: false });
        const wrongChannel = await anonymous(channels[business === "dh" ? "bo" : "dh"]);
        await db.update(s.inboxConversations).set({ mergedIntoId: current.id, status: "closed", isCurrent: false }).where(eq(s.inboxConversations.id, wrongChannel.id));
        await addJob(wrongChannel, "sent", { include: false });
        const [foreignChannel] = await db.insert(s.inboxChannels).values({ orgId: ctx.otherActor.orgId, workspaceId: 9, publicKey: randomBytes(24).toString("hex"), name: "허구 다른 조직 전용", enabled: true }).returning();
        const wrongOrg = await anonymous(foreignChannel);
        await db.update(s.inboxConversations).set({ mergedIntoId: current.id, status: "closed", isCurrent: false }).where(eq(s.inboxConversations.id, wrongOrg.id));
        await addJob(wrongOrg, "sent", { include: false });
        await addJob(sources[0], "sent", { include: false, extra: { workspaceId: channels[business === "dh" ? "bo" : "dh"].workspaceId } });
    }
    const { jobId: currentReadyId } = await client.generateSupportDraft(current.id, randomUUID());
    expectedJobIds.push(currentReadyId);
    const ready = await client.supportDraft(current.id, currentReadyId);
    assert.equal(ready.job.state, "ready"); assert.equal(ready.usable, true); assert.equal(modelCalls, 2);
    const preservedIds = [...expectedJobIds.filter(id => id !== currentReadyId), ...excludedJobIds];
    const snapshot = JSON.stringify(await seededRows(ctx, preservedIds));
    return { business, workspaceId, channel, client, current, sources, currentReadyId, oldReadyId: oldReady.id, expectedJobIds, excludedJobIds, knowledgeId: knowledge.id, expectedCallsByJob, preservedIds, snapshot, fakeModelCalls: () => modelCalls, fact, activeBefore, terminalBefore };
}

async function runMergedAiHistoryCheck(extra) {
    return runPlatformCheck(async ctx => {
        const { db, clients } = ctx;
        const s = require("../src/lib/db/schema.ts"), { eq, desc, inArray } = require("drizzle-orm");
        const seeded = await seedMergedAiHistory(ctx);
        const { current, sources, currentReadyId, oldReadyId, expectedJobIds, excludedJobIds, expectedCallsByJob, preservedIds, snapshot } = seeded;
        let checks = 0;
        async function check(name, run) { await run(); console.log(`PASS MERGED AI ${++checks} ${name}`); }
        const rejectStatus = (...values) => error => values.includes(error.status);
        const expected = await db.select().from(s.customerAiJobs).where(inArray(s.customerAiJobs.id, expectedJobIds)).orderBy(desc(s.customerAiJobs.createdAt), desc(s.customerAiJobs.id));
        async function pages(load) {
            const rows = [], cursors = new Set(); let before;
            for (let i = 0; i < 10; i++) {
                const page = await load(before); assert.ok(page.rows.length <= 50); rows.push(...page.rows);
                if (!page.hasMore) return rows;
                assert.equal(page.rows.length, 50); before = page.rows.at(-1).id;
                assert.equal(cursors.has(before), false); cursors.add(before);
            }
            assert.fail("Pagination did not terminate");
        }
        await check("실제 익명→회원 병합은 terminal 원본 보존·활성 작업 stale·다중 원본 이력 유지", async () => {
            assert.equal(sources.length, 2); assert.ok(expectedJobIds.length > 100);
            for (const source of sources) {
                const [chat] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, source.id));
                assert.equal(chat.mergedIntoId, current.id); assert.equal(chat.status, "closed");
            }
            const count = expected.filter(row => row.createdAt.getTime() === AT.getTime()).length; assert.ok(count > 100);
        });
        let serviceRows, nativeRows;
        await check("SDK/service 50개 cursor: 동일시각·현재/원본 교차·누락0·중복0·원본 표시", async () => {
            serviceRows = await pages(before => clients.dh.supportDrafts(current.id, before));
            assert.deepEqual(serviceRows.map(row => row.id), expected.map(row => row.id));
            assert.equal(new Set(serviceRows.map(row => row.id)).size, expectedJobIds.length);
            for (const row of serviceRows) {
                const original = expected.find(item => item.id === row.id);
                assert.equal(row.originConversationId, original.conversationId);
                assert.equal(row.fromMergedConversation, original.conversationId !== current.id);
                assert.equal(new Date(row.createdAt).getTime(), original.createdAt.getTime()); assert.equal(row.state, original.state);
                assert.ok(!("context" in row) && !("sources" in row) && !("answer" in row) && !("leaseId" in row));
            }
            assert.ok(serviceRows.some(row => sources.some(source => source.id === row.originConversationId)));
        });
        await check("실제 native cookie 목록/다음페이지가 SDK와 동일하고 read 토큰도 읽기 가능", async () => {
            nativeRows = await pages(before => nativeAi(ctx, current.id, { before }));
            assert.deepEqual(nativeRows, serviceRows);
            const read = await pages(before => clients.read.supportDrafts(current.id, before)); assert.deepEqual(read, serviceRows);
        });
        await check("원본 상세·생성/검토 호출 이력·token usage·createdAt/state 보존·과거ready 사용불가", async () => {
            for (const row of serviceRows.filter(item => item.fromMergedConversation)) {
                const view = await clients.dh.supportDraft(current.id, row.id);
                assert.equal(view.job.originConversationId, row.originConversationId); assert.equal(view.job.fromMergedConversation, true); assert.equal(view.usable, false);
                assert.equal(view.job.state, row.state); assert.equal(view.job.createdAt, row.createdAt); assert.equal("leaseId" in view.job, false);
                const wanted = expectedCallsByJob.get(row.id);
                assert.deepEqual(view.calls.map(call => ({ id: call.id, stage: call.stage, state: call.state, provider: call.provider, model: call.model, promptTokens: call.promptTokens, completionTokens: call.completionTokens, startedAt: call.startedAt, finishedAt: call.finishedAt })), wanted.map(call => ({ id: call.id, stage: call.stage, state: call.state, provider: call.provider, model: call.model, promptTokens: call.promptTokens, completionTokens: call.completionTokens, startedAt: call.startedAt.toISOString(), finishedAt: call.finishedAt.toISOString() })));
            }
            const legacy = await nativeAi(ctx, current.id, { runId: oldReadyId }); assert.equal(legacy.job.state, "ready"); assert.equal(legacy.usable, false);
            assert.deepEqual(legacy, await clients.dh.supportDraft(current.id, oldReadyId));
            assert.equal(JSON.stringify(await seededRows(ctx, preservedIds)), snapshot);
        });
        await check("임의run·다른회원·채널·조직·workspace 불일치의 상세와 cursor 제외", async () => {
            for (const id of [...excludedJobIds, randomUUID()]) {
                assert.equal(serviceRows.some(row => row.id === id), false);
                await assert.rejects(clients.dh.supportDraft(current.id, id), rejectStatus(404));
                await assert.rejects(clients.dh.supportDrafts(current.id, id), rejectStatus(404));
                await nativeAi(ctx, current.id, { runId: id, expected: 404 });
                await nativeAi(ctx, current.id, { before: id, expected: 404 });
            }
            await assert.rejects(clients.bo.supportDrafts(current.id), rejectStatus(403));
            await assert.rejects(clients.bo.supportDraft(current.id, oldReadyId), rejectStatus(403));
            await nativeAi(ctx, current.id, { who: ctx.otherActor, expected: 404 });
            await nativeAi(ctx, current.id, { runId: oldReadyId, who: ctx.otherActor, expected: 404 });
            await assert.rejects(clients.dh.supportDraft(current.id, "invalid-id"), rejectStatus(404, 400));
            await nativeAi(ctx, current.id, { before: "invalid-id", expected: 400 });
        });
        await check("현재상담으로 옛 작업 전송·취소·재생성payload 거절하고 DB/모델호출 불변", async () => {
            const count = seeded.fakeModelCalls();
            await assert.rejects(clients.dh.reply(current.id, "옛 초안 재사용 금지", randomUUID(), "reply", [], oldReadyId), rejectStatus(409));
            await assert.rejects(clients.dh.cancelSupportDraft(current.id, oldReadyId), rejectStatus(409));
            await nativeAi(ctx, current.id, { runId: oldReadyId, method: "POST", body: { action: "cancel" }, expected: 409 });
            await assert.rejects(clients.dh.request(`/api/v1/inbox/conversations/${current.id}/ai`, "POST", { clientId: randomUUID(), runId: oldReadyId }), rejectStatus(400));
            await nativeAi(ctx, current.id, { method: "POST", body: { clientId: randomUUID(), runId: oldReadyId }, expected: 400 });
            await assert.rejects(clients.read.generateSupportDraft(current.id, randomUUID()), rejectStatus(403));
            await assert.rejects(clients.read.cancelSupportDraft(current.id, currentReadyId), rejectStatus(403));
            assert.equal(seeded.fakeModelCalls(), count);
            assert.equal(JSON.stringify(await seededRows(ctx, preservedIds)), snapshot);
            assert.equal((await clients.dh.supportDraft(current.id, currentReadyId)).usable, true);
        });
        await check("병합 원본ID 직접 전송·재생성·취소도 거절", async () => {
            await assert.rejects(clients.dh.reply(sources[0].id, "옛 상담 직접 전송 금지", randomUUID(), "reply", [], oldReadyId), rejectStatus(404, 409));
            await assert.rejects(clients.dh.generateSupportDraft(sources[0].id, randomUUID()), rejectStatus(404, 409));
            await assert.rejects(clients.dh.cancelSupportDraft(sources[0].id, oldReadyId), rejectStatus(404, 409));
            await nativeAi(ctx, sources[0].id, { runId: oldReadyId, method: "POST", body: { action: "cancel" }, expected: 409 });
            assert.equal(JSON.stringify(await seededRows(ctx, preservedIds)), snapshot);
        });
        await check("현재 ready 초안은 계속 사용 가능하며 한 번 전송 후 재사용 차단", async () => {
            const ready = await clients.dh.supportDraft(current.id, currentReadyId); assert.equal(ready.usable, true); assert.equal(ready.job.fromMergedConversation, false); assert.equal(ready.job.originConversationId, current.id);
            await clients.dh.reply(current.id, ready.job.answer, randomUUID(), "reply", [], currentReadyId);
            const sent = await clients.dh.supportDraft(current.id, currentReadyId); assert.equal(sent.job.state, "sent"); assert.equal(sent.usable, false);
            await assert.rejects(clients.dh.reply(current.id, ready.job.answer, randomUUID(), "reply", [], currentReadyId), rejectStatus(409));
            assert.equal(JSON.stringify(await seededRows(ctx, preservedIds)), snapshot);
            assert.equal(seeded.fakeModelCalls(), 2);
        });
        await check("고객 headless DTO에는 직원 AI 작업·호출·원본 표시가 노출되지 않음", async () => {
            const visible = await current.sdk.conversation(current.id), json = JSON.stringify(visible);
            for (const value of [oldReadyId, "fromMergedConversation", "originConversationId", "fictional-model-no-network", "promptTokens", "settingsSnapshot"]) assert.equal(json.includes(value), false);
            assert.ok(visible.messages.some(message => message.kind === "reply"));
        });
        await check("현재 권한 회수 직후 같은 viewer 쿠키·read 서비스 토큰의 목록/상세/cursor403", async () => {
            const { generateToken } = require("../src/lib/auth.ts");
            const viewer = { ...ctx.actor, userId: randomUUID(), role: "member", tokenVersion: 0, name: "허구 AI 이력 열람 직원" };
            await db.insert(s.users).values({ id: viewer.userId, orgId: viewer.orgId, name: viewer.name, email: `${viewer.userId}@example.test`, password: "fictional-only" });
            await db.insert(s.organizationMembers).values({ organizationId: viewer.orgId, userId: viewer.userId, role: "member", tokenVersion: 0 });
            const [grant] = await db.insert(s.customerWorkspaceAccess).values({ orgId: viewer.orgId, workspaceId: seeded.workspaceId, userId: viewer.userId, role: "viewer" }).returning();
            const cookie = `token=${generateToken({ ...viewer, email: "fictional-viewer@example.test" })}`;
            const first = await nativeAi(ctx, current.id, { cookie });
            assert.ok(first.rows.some(row => row.fromMergedConversation)); assert.ok(first.rows.some(row => !row.fromMergedConversation));
            const before = first.rows.at(-1).id;
            const requests = [{}, { runId: currentReadyId }, { runId: oldReadyId }, { before }];
            for (const request of requests) await nativeAi(ctx, current.id, { cookie, ...request });
            await db.delete(s.customerWorkspaceAccess).where(eq(s.customerWorkspaceAccess.id, grant.id));
            for (const request of requests) await nativeAi(ctx, current.id, { cookie, ...request, expected: 403 });
            const [token] = await db.select().from(s.apiTokens).where(eq(s.apiTokens.token, ctx.keys.read));
            const scopes = await db.select().from(s.apiTokenScopes).where(eq(s.apiTokenScopes.tokenId, token.id));
            assert.equal(scopes.length, 1); assert.equal(scopes[0].scopeType, "workspace"); assert.equal(scopes[0].scopeId, seeded.workspaceId);
            const readRequests = [() => clients.read.supportDrafts(current.id), () => clients.read.supportDraft(current.id, currentReadyId), () => clients.read.supportDraft(current.id, oldReadyId), () => clients.read.supportDrafts(current.id, before)];
            for (const request of readRequests) await request();
            try {
                await db.update(s.apiTokenScopes).set({ permissions: { read: false, create: false, update: false, delete: false } }).where(eq(s.apiTokenScopes.id, scopes[0].id));
                for (const request of readRequests) await assert.rejects(request(), rejectStatus(403));
                await db.update(s.apiTokenScopes).set({ scopeId: ctx.channels.bo.workspaceId, permissions: { read: true, create: false, update: false, delete: false } }).where(eq(s.apiTokenScopes.id, scopes[0].id));
                for (const request of readRequests) await assert.rejects(request(), rejectStatus(403));
            } finally {
                await db.update(s.apiTokenScopes).set({ scopeId: scopes[0].scopeId, permissions: scopes[0].permissions }).where(eq(s.apiTokenScopes.id, scopes[0].id));
            }
            for (const request of readRequests) await request();
            assert.equal(JSON.stringify(await seededRows(ctx, preservedIds)), snapshot);
            assert.equal(seeded.fakeModelCalls(), 2);
        });
        console.log(JSON.stringify({ suite: "merged-ai-history", checks, expectedJobs: expectedJobIds.length, excludedJobs: excludedJobIds.length, sameTimestampJobs: expected.filter(row => row.createdAt.getTime() === AT.getTime()).length, sourceConversations: sources.length, permissionRevocation: true, fakeModelCalls: seeded.fakeModelCalls(), actualModelCalls: 0, actualNetworkCalls: 0, realCustomerData: false, nativeAndServiceRoutes: true, database: "memory PGlite", scope: "staff AI history only; full Inbox visual QA is separate" }));
        if (extra) await extra({ ...ctx, seeded });
        else await ctx.pg.close();
    });
}
module.exports = { seedMergedAiHistory, runMergedAiHistoryCheck, nativeAi };
if (require.main === module) runMergedAiHistoryCheck().catch(error => { console.error(error); process.exitCode = 1; });
