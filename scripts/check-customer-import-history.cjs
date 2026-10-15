/* eslint-disable @typescript-eslint/no-require-imports -- Actual importer/routes/SDK against fictional memory PGlite only. Run through the root network guard. */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
const { channelFixture, PRIVATE, PRIVATE_TITLE, PRIVATE_FILE, RAW_PROFILE, AT } = require("./fixtures/customer-import-history-fictional.cjs");
const BASE = "http://127.0.0.1:3120";
const rejects = (...statuses) => error => statuses.includes(error.status);
function singleSource(memberId, keepFiles = false) {
    const fixture = channelFixture({ conversations: 1, messages: 2, memberId });
    fixture.bundle.users = fixture.bundle.users.filter(row => row.id === "source-a");
    fixture.bundle.userChats = fixture.bundle.userChats.filter(row => row.id === "history-a-000");
    fixture.bundle.messages = fixture.bundle.messages.filter(row => row.chatId === "history-a-000").map(row => keepFiles ? row : { ...row, files: undefined });
    return fixture.bundle;
}
async function completeImport(client, input) {
    let job = await client.previewImport(input);
    assert.deepEqual(job.errors, []); assert.equal(job.state, "ready");
    job = await client.changeImport(job.id, { action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true });
    let attempts = 0;
    while (job.state === "running" && attempts++ < 100) job = await client.stepImport(job.id, job.cursor);
    assert.equal(job.state, "completed", job.reason);
    return job;
}
function customer(ctx, channel, tokenProvider) {
    const { SendbMessengerClient } = require("../sdk/messenger.ts");
    return new SendbMessengerClient({ apiBase: BASE, channelKey: channel.publicKey, getToken: typeof tokenProvider === "function" ? tokenProvider : () => tokenProvider, fetchImpl: ctx.dispatch });
}
async function raw(ctx, channel, token, suffix = "", method = "GET", body) {
    const multipart = body instanceof FormData;
    return ctx.dispatch(`${BASE}/api/messenger/${channel.publicKey}${suffix}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
}
async function targets(ctx, workspaceId, namespace) {
    const s = require("../src/lib/db/schema.ts"), { and, eq } = require("drizzle-orm");
    const rows = await ctx.db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.orgId, ctx.actor.orgId), eq(s.customerImportObjects.workspaceId, workspaceId), eq(s.customerImportObjects.source, "channel"), eq(s.customerImportObjects.namespace, namespace)));
    const lookup = (kind, sourceId) => { const found = rows.find(row => row.kind === kind && row.sourceId === sourceId); assert.ok(found, `Missing fictional imported ${kind}/${sourceId}`); return found.targetId; };
    return { rows, lookup };
}
/** Reusable fictional seed for an isolated UI host; does not start a server or call a model. */
async function seedCustomerImportHistory(ctx, options = {}) {
    const business = options.business ?? "dh", channel = ctx.channels[business], client = ctx.clients[business], workspaceId = channel.workspaceId;
    const fixture = channelFixture({ business, conversations: options.large === false ? 3 : 52, messages: options.large === false ? 5 : 121 });
    const company = await client.upsertCompany({ workspaceId, externalId: `fictional-history-company-${business}`, name: "허구 같은 회사", domain: "fictional-company.example.test" });
    const people = {};
    for (const [name, externalId] of Object.entries({ a: fixture.memberId, b: fixture.otherId, colleague: fixture.colleagueId, lookalike: "fictional-unrelated-same-name-email" })) {
        const contact = await client.upsertContact({ workspaceId, externalId, name: "허구 동일 표시명", email: "fictional-same@example.test", companyIds: [company.id], attributes: { fixture: "existing verified site CRM identity" } });
        const token = (await client.customerIdentity(channel.id, contact.id)).identityToken;
        people[name] = { contact, token, sdk: customer(ctx, channel, token) };
    }
    const namespace = options.namespace ?? `fictional-history-${business}`;
    const input = { workspaceId, source: "channel", namespace, format: "json", content: JSON.stringify(fixture.bundle), verifiedCustomerHistory: true };
    // The importer sorts a batch chronologically. Insert the oldest public row
    // in a later real import so historical ordering cannot accidentally pass by ID.
    const lateMessage = business === "dh" && options.large !== false
        ? fixture.bundle.messages.find(row => row.chatId === fixture.publicChats[0] && row.id === "public-120")
        : undefined;
    const firstInput = lateMessage ? { ...input, content: JSON.stringify({ ...fixture.bundle, messages: fixture.bundle.messages.filter(row => row !== lateMessage) }) } : input;
    const preview = await client.previewImport(firstInput);
    assert.deepEqual(preview.errors, []);
    for (const [sourceId, name] of [["source-a", "a"], ["source-b", "b"], ["source-colleague", "colleague"]]) {
        const planned = preview.rows.find(row => row.kind === "contacts" && row.sourceId === sourceId);
        assert.equal(planned.operation, "link"); assert.equal(planned.targetId, people[name].contact.id);
        assert.equal(planned.data.externalId, people[name].contact.externalId);
    }
    let job = await client.changeImport(preview.id, { action: "start", version: preview.version, fingerprint: preview.fingerprint, acknowledge: true });
    let steps = 0;
    while (job.state === "running" && steps++ < 100) job = await client.stepImport(job.id, job.cursor);
    assert.equal(job.state, "completed", job.reason);
    if (lateMessage) {
        job = await completeImport(client, input);
        const appended = job.rows.find(row => row.kind === "messages" && row.sourceId === `${lateMessage.chatId}/${lateMessage.id}`);
        assert.ok(appended); assert.equal(appended.operation, "create");
    }
    const mapped = await targets(ctx, workspaceId, namespace);
    const attachments = {};
    const filePage = await client.importFiles(job.id);
    assert.equal(filePage.total, fixture.files.length);
    for (const source of fixture.files) {
        const task = filePage.rows.find(row => row.fileName === source.name); assert.ok(task);
        const ready = await client.uploadImportFile(job.id, task.id, task.version, new Blob([source.bytes]), source.name);
        assert.equal(ready.state, "ready"); attachments[source.kind] = { ...ready, bytes: source.bytes };
    }
    return { business, channel, client, workspaceId, namespace, fixture, input, job, preview, people, attachments, mapped, historyIds: fixture.publicChats.map(id => mapped.lookup("conversations", id)), hiddenIds: fixture.hiddenChats.map(id => mapped.lookup("conversations", id)), mainId: mapped.lookup("conversations", fixture.publicChats[0]), publicMessageIds: fixture.bundle.messages.filter(row => row.chatId === fixture.publicChats[0] && !row.options?.includes("private")).map(row => Number(mapped.lookup("messages", `${row.chatId}/${row.id}`))), privateMessageId: Number(mapped.lookup("messages", `${fixture.publicChats[0]}/private-note`)) };
}
async function allConversations(sdk) {
    const rows = [], cursors = new Set(); let before;
    for (let attempt = 0; attempt < 10; attempt++) {
        const page = await sdk.conversations(before); assert.ok(page.rows.length <= 50); rows.push(...page.rows);
        if (!page.hasMore) { assert.equal(page.nextBefore, null); return { rows, unreadCount: page.unreadCount }; }
        assert.equal(page.rows.length, 50); assert.ok(page.nextBefore); assert.equal(cursors.has(page.nextBefore), false);
        cursors.add(page.nextBefore); before = page.nextBefore;
    }
    assert.fail("Customer conversation cursor did not terminate");
}
function privateFree(value) {
    const text = JSON.stringify(value);
    for (const marker of [PRIVATE, PRIVATE_TITLE, PRIVATE_FILE, RAW_PROFILE, "fictional-source-only", "signature=", "importMetadata", "externalId", "sourceKey", "sourceMessageId", "settingsSnapshot", "recordId", "authorId", "ownerKey"]) assert.equal(text.includes(marker), false, `Private field leaked: ${marker}`);
}
async function historicalSnapshot(ctx, ids) {
    const s = require("../src/lib/db/schema.ts"), { asc, inArray } = require("drizzle-orm");
    const chats = await ctx.db.select().from(s.inboxConversations).where(inArray(s.inboxConversations.id, ids)).orderBy(asc(s.inboxConversations.id));
    const messages = await ctx.db.select().from(s.inboxMessages).where(inArray(s.inboxMessages.conversationId, ids)).orderBy(asc(s.inboxMessages.id));
    const files = await ctx.db.select().from(s.inboxAttachments).where(inArray(s.inboxAttachments.messageId, messages.map(row => row.id))).orderBy(asc(s.inboxAttachments.id));
    const reads = await ctx.db.select().from(s.inboxCustomerReads).where(inArray(s.inboxCustomerReads.conversationId, ids)).orderBy(asc(s.inboxCustomerReads.conversationId));
    return JSON.stringify({ chats, messages, files, reads });
}
async function runCustomerImportHistoryCheck(extra) {
    return runPlatformCheck(async ctx => {
        const { db, actor, clients, channels, repo } = ctx, s = require("../src/lib/db/schema.ts"), { eq, and, sql, desc } = require("drizzle-orm");
        const dh = await seedCustomerImportHistory(ctx), bo = await seedCustomerImportHistory(ctx, { business: "bo", large: false });
        let checks = 0;
        const check = async (name, run) => { await run(); console.log(`PASS CUSTOMER IMPORT HISTORY ${++checks} ${name}`); };
        const count = async table => (await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0].n;
        let dhList;
        await check("실제 Channel importer의 검토 externalId는 사업별 기존 회원에 연결·본인만 과거 공개", async () => {
            assert.notEqual(dh.people.a.contact.id, bo.people.a.contact.id); assert.equal(dh.people.a.contact.externalId, bo.people.a.contact.externalId);
            for (const seeded of [dh, bo]) {
                const page = await allConversations(seeded.people.a.sdk);
                assert.deepEqual(new Set(page.rows.map(row => row.id)), new Set(seeded.historyIds));
                assert.equal(page.unreadCount, 0); assert.ok(page.rows.every(row => row.historyOnly === true && row.readOnly === true && row.isCurrent === false && row.unread === 0));
                privateFree(page); if (seeded === dh) dhList = page;
                const detail = await seeded.people.a.sdk.conversation(seeded.mainId); assert.equal(detail.historyOnly, true); assert.equal(detail.readOnly, true); assert.equal(detail.conversationId, seeded.mainId); privateFree(detail);
                const staff = await repo.conversationDetail(actor, seeded.mainId, db); assert.ok(staff.messages.some(row => row.kind === "note" && row.body.includes(PRIVATE)));
            }
        });
        await check("동일시각 52개 과거 상담 cursor의 누락·중복0, 메모 q가 공개미리보기/날짜를 바꾸지 않음", async () => {
            assert.equal(dhList.rows.length, 52); assert.equal(new Set(dhList.rows.map(row => row.id)).size, 52);
            const expected = await db.select({ id: s.inboxConversations.id }).from(s.inboxConversations).where(and(eq(s.inboxConversations.channelId, channels.dh.id), eq(s.inboxConversations.contactId, dh.people.a.contact.id), sql`${s.inboxConversations.id} = ANY(${`{${dh.historyIds.join(",")}}`}::uuid[])`)).orderBy(desc(s.inboxConversations.id));
            assert.deepEqual(dhList.rows.map(row => row.id), expected.map(row => row.id));
            const first = await dh.people.a.sdk.conversations();
            const response = await raw(ctx, channels.dh, dh.people.a.token, `/conversations?q=${encodeURIComponent(PRIVATE)}`); assert.equal(response.status, 200);
            assert.deepEqual((await response.json()).data, first);
            for (const row of dhList.rows) { assert.equal(new Date(row.lastMessageAt).toISOString(), AT); assert.ok(row.title.includes("허구 공개")); privateFree(row); }
            const noteOnly = dh.mapped.lookup("conversations", "note-only"); await assert.rejects(dh.people.a.sdk.conversation(noteOnly), rejects(404));
        });
        await check("121개 공개 메시지는 과거 시각·ID로 끝까지 조회하며 note/다른상담 cursor404", async () => {
            const rows = [], ordered = []; let before;
            for (let attempt = 0; attempt < 5; attempt++) {
                const page = await dh.people.a.sdk.conversation(dh.mainId, before); privateFree(page); rows.push(...page.messages); ordered.push(...[...page.messages].reverse());
                assert.ok(page.messages.every(row => row.kind !== "note"));
                if (!page.hasOlder) break;
                before = page.messages[0].id;
            }
            assert.equal(rows.length, 121); assert.deepEqual(new Set(rows.map(row => row.id)), new Set(dh.publicMessageIds));
            const expected = await db.select().from(s.inboxMessages).where(and(eq(s.inboxMessages.conversationId, dh.mainId), sql`${s.inboxMessages.kind}<>'note'`)).orderBy(desc(s.inboxMessages.createdAt), desc(s.inboxMessages.id));
            assert.deepEqual(ordered.map(row => row.id), expected.map(row => row.id));
            assert.notDeepEqual(expected.map(row => row.id), [...dh.publicMessageIds].sort((a, b) => b - a), "Fixture must distinguish source chronology from insert-ID order");
            await assert.rejects(dh.people.a.sdk.conversation(dh.mainId, dh.privateMessageId), rejects(404));
            await assert.rejects(dh.people.a.sdk.conversation(dh.mainId, bo.publicMessageIds[0]), rejects(404));
            await assert.rejects(dh.people.a.sdk.conversation(dh.mainId, 2147483647), rejects(404));
        });
        await check("다른회원·동료·동명/동일이메일·비회원은 직접ID/목록cursor/메모첨부로 본인 이력 접근불가", async () => {
            const { customerConversationCursor } = require("../src/lib/inbox-customer-history/rules.ts");
            const cursor = customerConversationCursor(new Date(AT), dh.mainId);
            for (const name of ["b", "colleague", "lookalike"]) {
                const person = dh.people[name], list = await allConversations(person.sdk);
                assert.ok(list.rows.every(row => !dh.historyIds.includes(row.id))); privateFree(list);
                await assert.rejects(person.sdk.conversation(dh.mainId), rejects(404));
                await assert.rejects(person.sdk.conversations(cursor), rejects(404));
                await assert.rejects(person.sdk.download(dh.attachments.customer.attachmentId, dh.mainId), rejects(404));
                await assert.rejects(person.sdk.download(dh.attachments.note.attachmentId, dh.mainId), rejects(404));
            }
            const anon = await repo.startVisitorSession(channels.dh.publicKey, { name: "허구 동일 표시명", email: "fictional-same@example.test" }, db);
            const anonSdk = customer(ctx, channels.dh, anon.token);
            await assert.rejects(anonSdk.conversations(), rejects(401)); await assert.rejects(anonSdk.conversation(dh.mainId), rejects(404));
            await assert.rejects(anonSdk.download(dh.attachments.customer.attachmentId, dh.mainId), rejects(404));
            // No token intentionally serves public widget configuration; it must
            // never turn the guessed conversation ID into an authenticated view.
            const publicResponse = await raw(ctx, channels.dh, null, `?conversationId=${dh.mainId}`);
            assert.equal(publicResponse.status, 200);
            const publicResult = await publicResponse.json(); assert.equal(publicResult.success, true);
            assert.deepEqual(Object.keys(publicResult.data).sort(), ["name", "greeting", "businessHours", "color", "allowedOrigins"].sort());
            for (const field of ["messages", "conversationId", "historyOnly", "readOnly", "preview", "attachments"]) assert.equal(Object.hasOwn(publicResult.data, field), false);
            const publicText = JSON.stringify(publicResult.data);
            for (const hidden of [dh.mainId, dh.attachments.customer.attachmentId, dh.attachments.note.attachmentId]) assert.equal(publicText.includes(hidden), false);
            privateFree(publicResult.data);
            assert.equal((await raw(ctx, channels.dh, null, "/conversations")).status, 401);
            assert.equal((await raw(ctx, channels.dh, "fictional-invalid-bearer", `?conversationId=${dh.mainId}`)).status, 401);
        });
        await check("두 사업 JWT audience·계정전환·만료 후 과거ID/파일/cursor 격리", async () => {
            await assert.rejects(customer(ctx, channels.bo, dh.people.a.token).conversations(), rejects(401));
            await assert.rejects(bo.people.a.sdk.conversation(dh.mainId), rejects(404));
            await assert.rejects(bo.people.a.sdk.download(dh.attachments.customer.attachmentId, dh.mainId), rejects(404));
            let token = dh.people.a.token; const switched = customer(ctx, channels.dh, () => token);
            assert.equal((await switched.conversation(dh.mainId)).conversationId, dh.mainId); token = dh.people.b.token;
            await assert.rejects(switched.conversation(dh.mainId), rejects(404)); token = dh.people.a.token;
            assert.equal((await switched.conversation(dh.mainId)).conversationId, dh.mainId);
            const expired = require("../src/lib/customer-platform/identity.ts").issueCustomerIdentity(dh.people.a.contact.id, channels.dh.publicKey, new Date("2000-01-01")).identityToken;
            const dead = customer(ctx, channels.dh, expired);
            await assert.rejects(dead.conversations(), rejects(401)); await assert.rejects(dead.conversation(dh.mainId), rejects(401)); await assert.rejects(dead.download(dh.attachments.customer.attachmentId, dh.mainId), rejects(401));
        });
        await check("가져온 고객파일·직원공개답변파일만 본인에게 byte일치 다운로드, 메모파일은 직원전용", async () => {
            for (const seeded of [dh, bo]) {
                for (const kind of ["customer", "reply"]) {
                    const file = seeded.attachments[kind];
                    const downloaded = await seeded.people.a.sdk.download(file.attachmentId, seeded.mainId);
                    assert.deepEqual(Buffer.from(downloaded.bytes), file.bytes);
                }
                await assert.rejects(seeded.people.a.sdk.download(seeded.attachments.note.attachmentId, seeded.mainId), rejects(404));
                const staffNote = await seeded.client.downloadAttachment(seeded.attachments.note.attachmentId); assert.deepEqual(Buffer.from(staffNote.bytes), seeded.attachments.note.bytes);
                const selection = await seeded.people.a.sdk.conversation(seeded.mainId, seeded.publicMessageIds.at(-1)); privateFree(selection);
            }
        });
        await check("비확인 member/veil/이름·이메일 매핑과 note-only는 유효한JWT라도 직원전용", async () => {
            for (const sourceId of ["email-name-only", "unconfirmed-member", "veil-collision", "missing-member-id"]) {
                const contactId = dh.mapped.lookup("contacts", sourceId), token = (await clients.dh.customerIdentity(channels.dh.id, contactId)).identityToken, sdk = customer(ctx, channels.dh, token);
                const id = dh.mapped.lookup("conversations", `excluded-${sourceId}`);
                assert.equal((await allConversations(sdk)).rows.length, 0); await assert.rejects(sdk.conversation(id), rejects(404)); await assert.rejects(dh.people.a.sdk.conversation(id), rejects(404));
                assert.ok((await repo.conversationDetail(actor, id, db)).messages.length > 0);
            }
        });
        await check("동일sourceID·memberId라도 다른namespace의 공개미확인 자료는 직원전용", async () => {
            const source = singleSource(dh.fixture.memberId), namespace = "fictional-history-unapproved-account";
            await completeImport(clients.dh, { ...dh.input, namespace, content: JSON.stringify(source), verifiedCustomerHistory: false });
            const mapped = await targets(ctx, dh.workspaceId, namespace), id = mapped.lookup("conversations", "history-a-000");
            assert.notEqual(id, dh.mainId); assert.equal(mapped.lookup("contacts", "source-a"), dh.people.a.contact.id);
            await assert.rejects(dh.people.a.sdk.conversation(id), rejects(404));
            assert.ok(!(await allConversations(dh.people.a.sdk)).rows.some(row => row.id === id));
            assert.ok((await repo.conversationDetail(actor, id, db)).messages.length > 0);
        });
        await check("재이전 A→B·익명→회원 신원변경과 unchanged chat reuse 뒤 old/new 모두 공개보류", async () => {
            for (const transition of ["member-change", "anonymous-to-member"]) {
                const namespace = `fictional-identity-${transition}`, source = singleSource(dh.fixture.memberId);
                if (transition === "anonymous-to-member") Object.assign(source.users[0], { type: "lead", member: false });
                await completeImport(clients.dh, { ...dh.input, namespace, content: JSON.stringify(source) });
                const initial = await targets(ctx, dh.workspaceId, namespace), id = initial.lookup("conversations", "history-a-000"), oldContact = initial.lookup("contacts", "source-a");
                const oldToken = (await clients.dh.customerIdentity(channels.dh.id, oldContact)).identityToken, oldSdk = customer(ctx, channels.dh, oldToken);
                if (transition === "member-change") assert.equal((await oldSdk.conversation(id)).conversationId, id);
                else await assert.rejects(oldSdk.conversation(id), rejects(404));
                const [before] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, id));
                const changed = structuredClone(source);
                Object.assign(changed.users[0], { type: "member", member: true, memberId: transition === "member-change" ? dh.fixture.otherId : dh.fixture.memberId });
                const reimport = await completeImport(clients.dh, { ...dh.input, namespace, content: JSON.stringify(changed), updateImported: true });
                assert.equal(reimport.rows.find(row => row.kind === "conversations").operation, "reuse");
                const [after] = await db.select().from(s.inboxConversations).where(eq(s.inboxConversations.id, id));
                assert.equal(after.id, before.id); assert.equal(after.contactId, before.contactId); assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
                for (const sdk of [oldSdk, dh.people.a.sdk, dh.people.b.sdk]) {
                    await assert.rejects(sdk.conversation(id), rejects(404));
                    assert.ok(!(await allConversations(sdk)).rows.some(row => row.id === id));
                }
                assert.ok((await repo.conversationDetail(actor, id, db)).messages.length > 0);
            }
        });
        await check("동일raw reuse로 직원전용→본인공개 승인→철회, 대화변경0·동일파일GET 즉시차단", async () => {
            const namespace = "fictional-history-consent-cycle", source = singleSource(dh.fixture.memberId, true);
            const input = { ...dh.input, namespace, content: JSON.stringify(source), verifiedCustomerHistory: false };
            const first = await completeImport(clients.dh, input), mapping = await targets(ctx, dh.workspaceId, namespace), id = mapping.lookup("conversations", "history-a-000");
            const fileSource = dh.fixture.files.find(file => file.kind === "customer"), task = (await clients.dh.importFiles(first.id)).rows.find(file => file.fileName === fileSource.name);
            const file = await clients.dh.uploadImportFile(first.id, task.id, task.version, new Blob([fileSource.bytes]), fileSource.name);
            assert.equal(file.state, "ready");
            const snapshot = await historicalSnapshot(ctx, [id]);
            await assert.rejects(dh.people.a.sdk.conversation(id), rejects(404)); await assert.rejects(dh.people.a.sdk.download(file.attachmentId, id), rejects(404));
            const approved = await completeImport(clients.dh, { ...input, verifiedCustomerHistory: true });
            assert.ok(approved.rows.every(row => row.operation === "reuse"));
            assert.equal(await historicalSnapshot(ctx, [id]), snapshot);
            assert.ok((await allConversations(dh.people.a.sdk)).rows.some(row => row.id === id));
            assert.equal((await dh.people.a.sdk.conversation(id)).readOnly, true);
            assert.deepEqual(Buffer.from((await dh.people.a.sdk.download(file.attachmentId, id)).bytes), fileSource.bytes);
            const withdrawn = await completeImport(clients.dh, input);
            assert.ok(withdrawn.rows.every(row => row.operation === "reuse"));
            assert.equal(await historicalSnapshot(ctx, [id]), snapshot);
            assert.ok(!(await allConversations(dh.people.a.sdk)).rows.some(row => row.id === id));
            await assert.rejects(dh.people.a.sdk.conversation(id), rejects(404)); await assert.rejects(dh.people.a.sdk.download(file.attachmentId, id), rejects(404));
            assert.ok((await repo.conversationDetail(actor, id, db)).messages.some(row => row.kind === "note"));
            const retained = await clients.dh.downloadAttachment(file.attachmentId); assert.deepEqual(Buffer.from(retained.bytes), fileSource.bytes);
        });
        await check("공개동의 reuse는 import-owned 고객의 수동편집 보호지문을 갱신하지 않음", async () => {
            const namespace = "fictional-history-manual-edit-guard", source = singleSource("fictional-new-import-owned-member");
            const input = { ...dh.input, namespace, content: JSON.stringify(source), verifiedCustomerHistory: false };
            const initial = await completeImport(clients.dh, input), mapping = await targets(ctx, dh.workspaceId, namespace);
            const beforeKey = mapping.rows.find(row => row.kind === "contacts" && row.sourceId === "source-a"); assert.equal(beforeKey.owned, true); assert.equal(beforeKey.jobId, initial.id);
            const [contact] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, beforeKey.targetId));
            const editedName = "허구 직원이 직접 수정한 고객 이름";
            await clients.dh.updateContact(contact.id, { workspaceId: dh.workspaceId, version: contact.version, name: editedName });
            const reused = await completeImport(clients.dh, { ...input, verifiedCustomerHistory: true });
            assert.ok(reused.rows.every(row => row.operation === "reuse"));
            const afterKey = (await targets(ctx, dh.workspaceId, namespace)).rows.find(row => row.kind === "contacts" && row.sourceId === "source-a");
            for (const field of ["sourceFingerprint", "targetFingerprint", "owned", "targetId"]) assert.equal(afterKey[field], beforeKey[field], `Reuse must preserve ${field}`);
            const stableKey = ({ jobId, updatedAt, ...stable }) => { void jobId; void updatedAt; return stable; };
            assert.deepEqual(stableKey(afterKey), stableKey(beforeKey)); assert.equal(afterKey.jobId, reused.id); assert.notEqual(afterKey.jobId, beforeKey.jobId);
            const changed = structuredClone(source); changed.users[0].profile.name = "허구 변경된 원본 이름";
            const preview = await clients.dh.previewImport({ ...input, verifiedCustomerHistory: true, updateImported: true, content: JSON.stringify(changed) });
            const row = preview.rows.find(item => item.kind === "contacts" && item.sourceId === "source-a");
            assert.equal(row.operation, "error"); assert.ok(row.errors.some(error => /수정.*자료|덮어쓰지/.test(error)));
            await assert.rejects(clients.dh.changeImport(preview.id, { action: "start", version: preview.version, fingerprint: preview.fingerprint, acknowledge: true }), rejects(409));
            const [preserved] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, beforeKey.targetId)); assert.equal(preserved.name, editedName);
        });
        await check("과거 read는 무변경ACK, 쓰기·파일·상담원요청·직원재개는 거절하고 이력/자동작업 불변", async () => {
            const ids = [...dh.historyIds, ...bo.historyIds], before = await historicalSnapshot(ctx, ids), jobs = await count(s.customerAiJobs), workflows = await count(s.customerWorkflowRuns), events = await count(s.platformEvents);
            const ack = await dh.people.a.sdk.markRead(dh.mainId, dh.publicMessageIds[0]); assert.deepEqual(ack, { lastMessageId: dh.publicMessageIds[0], readRevision: 0, unread: 0 });
            await assert.rejects(dh.people.a.sdk.markRead(dh.mainId, dh.privateMessageId), rejects(404, 409));
            await assert.rejects(dh.people.a.sdk.sendMessage(dh.mainId, { clientId: randomUUID(), body: "과거 기록에 쓰면 안 됩니다." }), rejects(404, 409));
            await assert.rejects(dh.people.a.sdk.sendMessage(dh.mainId, { clientId: randomUUID(), body: "상담원 연결 부탁합니다." }), rejects(404, 409));
            await assert.rejects(dh.people.a.sdk.upload(new Blob([dh.attachments.customer.bytes]), "새 파일.pdf", randomUUID(), { conversationId: dh.mainId }), rejects(404, 409));
            await assert.rejects(clients.dh.reply(dh.mainId, "과거에 직원답변 금지", randomUUID()), rejects(409));
            await assert.rejects(clients.dh.updateConversation(dh.mainId, { status: "open" }), rejects(409));
            assert.equal(await historicalSnapshot(ctx, ids), before); assert.equal(await count(s.customerAiJobs), jobs); assert.equal(await count(s.customerWorkflowRuns), workflows); assert.equal(await count(s.platformEvents), events);
        });
        await check("과거만 있는 본인의 기본 문의는 비어 있고 새 현재문의/첨부/직원답변/로그인 병합 유지", async () => {
            const base = await dh.people.a.sdk.conversation(); assert.equal(base.conversationId, null); assert.equal(base.historyOnly, false); assert.equal(base.readOnly, false);
            const upload = await dh.people.a.sdk.upload(new Blob([dh.attachments.customer.bytes]), "현재 문의.pdf", randomUUID(), { newConversation: true });
            const created = await dh.people.a.sdk.createConversation({ clientId: randomUUID(), body: "지금의 새 문의", attachmentIds: [upload.id] });
            assert.ok(!dh.historyIds.includes(created.conversationId)); await dh.people.a.sdk.sendMessage(created.conversationId, { clientId: randomUUID(), body: "현재 문의 추가" });
            await clients.dh.reply(created.conversationId, "허구 현재 답변", randomUUID());
            const current = await dh.people.a.sdk.conversation(); assert.equal(current.conversationId, created.conversationId); assert.equal(current.historyOnly, false); assert.equal(current.readOnly, false);
            assert.deepEqual(Buffer.from((await dh.people.a.sdk.download(upload.id, created.conversationId)).bytes), dh.attachments.customer.bytes);
            const anon = await repo.startVisitorSession(channels.dh.publicKey, { name: "허구 로그인 전" }, db); await repo.sendVisitorMessage(channels.dh.publicKey, anon.token, { clientId: randomUUID(), body: "로그인 전 현재 문의" }, db);
            const linked = await require("../src/lib/inbox/link-identity.ts").linkVisitorIdentity(channels.dh.publicKey, dh.people.a.token, { action: "identify", anonymousToken: anon.token }, db); assert.equal(linked.id, created.conversationId);
            assert.ok((await dh.people.a.sdk.conversation()).messages.some(row => row.body === "로그인 전 현재 문의"));
            const after = await allConversations(dh.people.a.sdk); assert.equal(after.rows.filter(row => row.historyOnly).length, 52); assert.equal(after.rows.filter(row => !row.historyOnly).length, 1);
            assert.equal((await dh.people.a.sdk.conversation(dh.mainId)).readOnly, true);
        });
        console.log(JSON.stringify({ suite: "customer-import-history", checks, businesses: 2, historyConversationCursorRows: 52, historyMessageCursorRows: 121, actualNetworkCalls: 0, actualModelCalls: 0, realCustomerData: false, database: "memory PGlite", coverage: "Actual reviewed Channel importer -> CRM externalId -> customer JWT -> public list/detail/files; native visual/browser QA separate" }));
        if (extra) await extra({ ...ctx, seeded: { dh, bo } }); else await ctx.pg.close();
    });
}
module.exports = { seedCustomerImportHistory, runCustomerImportHistoryCheck, completeImport, customer, raw };
if (require.main === module) runCustomerImportHistoryCheck().catch(error => { console.error(error); process.exitCode = 1; });
