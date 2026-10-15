/* eslint-disable @typescript-eslint/no-require-imports -- 허구 Channel export→실제 importer, memory PGlite 전용 회귀 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const fixture = require("./fixtures/channel-source-export-fictional.json");
assert.equal(fixture.fictional, true);
let forbiddenRequests = 0;
const forbid = () => {
    forbiddenRequests++;
    throw new Error("허구 export QA는 실제 HTTP/API/서버를 호출하지 않습니다.");
};
global.fetch = forbid;
for (const name of ["node:http", "node:https"]) {
    const transport = require(name);
    transport.request = forbid;
    transport.get = forbid;
}
const clone = (value) => structuredClone(value);
function fakeSource() {
    const calls = [];
    const request = async (input) => {
        assert.equal(input.method, "GET");
        assert.deepEqual(input.headers, { "Channel-Version": "2026-06-01" });
        assert.ok(input.timeoutMs > 0);
        assert.ok(input.signal instanceof AbortSignal);
        assert.ok(!input.path.includes("/v5/"));
        assert.notEqual(input.path, "/open/users", "No all-customer enumeration claim");
        calls.push(clone({ path: input.path, query: input.query }));
        const page = (kind, rows, extra = {}) => {
            const cursor = input.query.cursor;
            const offset = cursor === undefined ? 0 : cursor === "page-2" ? 2 : Number.NaN;
            assert.ok(Number.isInteger(offset), "Unknown fictional cursor");
            const values = rows.slice(offset, offset + 2), hasNext = offset + 2 < rows.length;
            return { status: 200, body: { [kind]: clone(values), hasNext, nextCursor: hasNext ? "page-2" : null, ...(kind === "messages" ? { bots: clone(fixture.bundle.bots.filter(bot => values.some(message => message.personType === "bot" && message.personId === bot.id))) } : {}), ...clone(extra) } };
        };
        if (input.path === "/open/channel") return { status: 200, body: { channel: { id: fixture.channelId, name: "허구 export 검수 채널" } } };
        if (input.path === "/open/managers") return page("managers", fixture.bundle.managers);
        if (input.path === "/open/user-chats") {
            assert.ok(fixture.states.includes(input.query.state));
            assert.equal(input.query.dateTimeFieldName, "deskUpdatedAt");
            assert.equal(input.query.sortOrder, "asc");
            assert.ok(!("from" in input.query) && !("to" in input.query));
            return page("userChats", fixture.bundle.userChats.filter(chat => chat.state === input.query.state));
        }
        const chatId = /^\/open\/user-chats\/([^/]+)\/messages$/.exec(input.path)?.[1];
        if (chatId) return page("messages", fixture.bundle.messages.filter(message => message.chatId === decodeURIComponent(chatId)));
        const userId = /^\/open\/users\/([^/]+)$/.exec(input.path)?.[1];
        if (userId) {
            const user = fixture.bundle.users.find(value => value.id === decodeURIComponent(userId));
            assert.ok(user, "Only fictional related users may be read");
            return { status: 200, body: { user: clone(user) } };
        }
        throw new Error("허구 source에 없는 endpoint: " + input.path);
    };
    return { calls, request };
}
async function scenario(ctx) {
    const { db, pg, clients, actor, repo, channels } = ctx;
    const s = require("../src/lib/db/schema.ts"), { eq, and, sql } = require("drizzle-orm");
    const importFiles = require("../src/lib/customer-import-files/repository.ts");
    const { normalizeImport } = require("../src/lib/customer-imports/adapters.ts");
    const { createImportInput, sourceExternalId } = require("../src/lib/customer-imports/rules.ts");
    const namespace = "허구 채널 export 통합 QA";
    const input = (bundle, extra = {}) => ({ workspaceId: 8, source: "channel", namespace, format: "json", content: JSON.stringify(bundle), ...extra });
    const preview = (bundle, extra) => clients.dh.previewImport(input(bundle, extra));
    const start = (job) => clients.dh.changeImport(job.id, { action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true });
    const count = async (table) => (await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0].n;
    const counts = async () => Object.fromEntries(await Promise.all(["crmContacts", "inboxConversations", "inboxMessages", "customerImportFiles", "inboxAttachments", "inboxAttachmentBlobs", "platformEvents", "customerAiJobs", "customerWorkflowRuns"].map(async name => [name, await count(s[name])])));
    async function finish(job) {
        let current = await start(job), steps = 0;
        while (current.state === "running" && steps++ < 20) current = await clients.dh.stepImport(current.id, current.cursor);
        assert.equal(current.state, "completed", current.reason);
        return current;
    }
    let n = 0, job, completed;
    async function check(name, run) { await run(); console.log(`PASS CHANNEL EXPORT IMPORT ${++n} ${name}`); }
    const importedObjects = () => db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.namespace, namespace), eq(s.customerImportObjects.workspaceId, 8)));
    const targetId = async (kind, sourceId) => {
        const value = (await importedObjects()).find(row => row.kind === kind && row.sourceId === sourceId);
        assert.ok(value, `${kind}/${sourceId} original relation`);
        return value.targetId;
    };
    await check("허구 3고객·6상태 상담·20메시지와 원본·회원/비회원·bot 이름 정규화", async () => {
        const normalized = normalizeImport(createImportInput.parse(input(fixture.bundle)));
        assert.deepEqual(normalized.errors, []);
        assert.equal(normalized.rows.length, 29);
        for (const user of fixture.bundle.users) assert.deepEqual(normalized.rows.find(row => row.kind === "contacts" && row.sourceId === user.id).original, user);
        for (const chat of fixture.bundle.userChats) {
            const row = normalized.rows.find(row => row.kind === "conversations" && row.sourceId === chat.id);
            assert.equal(row.data.name, chat.title ?? chat.name);
            assert.equal(row.data.status, chat.state === "closed" ? "closed" : chat.state === "snoozed" ? "snoozed" : "open");
            assert.deepEqual(row.original, chat);
        }
        const contacts = normalized.rows.filter(row => row.kind === "contacts");
        assert.equal(contacts.find(row => row.sourceId === "qa-user-a").data.externalId, "qa-fictional-member-alpha");
        assert.equal(contacts.find(row => row.sourceId === "qa-user-b").data.externalId, undefined);
        assert.equal(contacts.find(row => row.sourceId === "qa-user-c").data.externalId, undefined);
        const bot = normalized.rows.find(row => row.sourceId === "qa-chat-open/qa-open-bot");
        assert.equal(bot.data.authorName, "허구 원본 안내 봇");
        assert.equal(bot.data.messageKind, "reply");
        assert.ok(normalized.warnings.some(warning => warning.includes("queued")));
        assert.ok(normalized.warnings.some(warning => warning.includes("memberId")));
    });
    await check("실제 API 미리보기는 원본 관계를 검토하며 대상 고객·상담·첨부·자동화는 변경하지 않음", async () => {
        const before = await counts();
        job = await preview(fixture.bundle, { expectedCounts: { contacts: 3, conversations: 6, messages: 20 } });
        assert.deepEqual(job.errors, []); assert.equal(job.total, 29); assert.equal(job.state, "ready");
        assert.deepEqual(await counts(), before);
        assert.ok(job.rows.every(row => row.operation === "create"));
        assert.ok(job.rows.filter(row => row.kind === "messages").every(row => row.dependencies.some(dependency => dependency.kind === "conversations")));
        await assert.rejects(clients.dh.changeImport(job.id, { action: "start", version: job.version, fingerprint: job.fingerprint }), error => error.status === 409);
    });
    await check("실제 start/25행 step·단계 재요청·완료까지 원자적 관계와 원본 composite ID 유지", async () => {
        const before = await counts(); let active = await start(job);
        active = await clients.dh.stepImport(active.id, active.cursor); assert.equal(active.state, "running"); assert.equal(active.cursor, 25);
        const afterStep = await counts(), retry = await clients.dh.stepImport(active.id, 0); assert.equal(retry.cursor, 25); assert.deepEqual(await counts(), afterStep);
        completed = await clients.dh.stepImport(active.id, active.cursor); assert.equal(completed.state, "completed"); assert.equal(completed.cursor, 29);
        const after = await counts(); assert.equal(after.crmContacts - before.crmContacts, 3); assert.equal(after.inboxConversations - before.inboxConversations, 6); assert.equal(after.inboxMessages - before.inboxMessages, 20);
        assert.equal(after.platformEvents, before.platformEvents); assert.equal(after.customerAiJobs, before.customerAiJobs); assert.equal(after.customerWorkflowRuns, before.customerWorkflowRuns);
        const keys = await importedObjects(); assert.equal(keys.length, 29);
        const duplicates = keys.filter(row => row.kind === "messages" && row.sourceId.endsWith("/shared-source-message")); assert.equal(duplicates.length, 6); assert.equal(new Set(duplicates.map(row => row.targetId)).size, 6);
    });
    await check("동일 고객의 여러 상담 관계·staff-only history와 고객 문의 화면 제외", async () => {
        for (const source of fixture.bundle.userChats) {
            const id = await targetId("conversations", source.id), detail = await repo.conversationDetail(actor, id, db);
            assert.equal(detail.conversation.contactId, await targetId("contacts", source.userId)); assert.equal(detail.conversation.historyOnly, true); assert.equal(detail.conversation.aiState, "human");
            assert.equal(detail.conversation.name, source.title ?? source.name);
        }
        const c = await targetId("contacts", "qa-user-a"), identity = await clients.dh.customerIdentity(channels.dh.id, c), detail = await repo.visitorDetail(channels.dh.publicKey, identity.identityToken, db);
        assert.equal(detail.conversationId, null); assert.deepEqual(detail.messages, []);
    });
    await check("내부 private/thread/system과 공개 manager/bot/customer를 구분하고 raw 전체를 보존", async () => {
        const source = await clients.dh.request(`/api/v1/imports/${job.id}?source=1`), archived = JSON.parse(source.input.content);
        assert.deepEqual(archived, fixture.bundle);
        const id = await targetId("conversations", "qa-chat-open"), detail = await repo.conversationDetail(actor, id, db);
        const note = detail.messages.find(message => message.body.includes("허구 내부 메모")); assert.equal(note.kind, "note"); assert.equal(note.importMetadata.sourceId, "qa-chat-open/qa-open-private");
        assert.equal(detail.messages.find(message => message.body === "허구 봇 공개 안내").authorName, "허구 원본 안내 봇");
        const activity = await clients.dh.customerActivities(8, await targetId("contacts", "qa-user-a")); assert.ok(!JSON.stringify(activity).includes("허구 내부 메모")); assert.ok(JSON.stringify(activity).includes("허구 공개 안내와 PDF"));
        assert.equal((await repo.conversationDetail(actor, await targetId("conversations", "qa-chat-missed"), db)).messages.find(message => message.body === "허구 시스템 이벤트").kind, "note");
    });
    await check("첨부 metadata 추출 완료와 실제 파일 bytes 완료를 별도 단계로 확인", async () => {
        const page = await clients.dh.importFiles(job.id); assert.equal(page.total, 2); assert.equal(await count(s.inboxAttachmentBlobs), 0);
        assert.equal(page.rows.find(row => row.fileName.endsWith("pdf")).state, "pending"); assert.equal(page.rows.find(row => row.fileName.endsWith("png")).state, "needs_source");
        assert.ok(!JSON.stringify(page).includes("fictional-only"));
        for (const download of fixture.downloads) {
            const task = page.rows.find(row => row.fileName === download.fileName), bytes = Buffer.from(download.base64, "base64");
            const sourceFile = fixture.bundle.messages.flatMap(message => message.files ?? []).find(file => file.id === download.fileId);
            assert.equal(bytes.length, sourceFile.size); assert.equal(createHash("sha256").update(bytes).digest("hex"), sourceFile.sha256);
            const saved = await importFiles.transferImportFile(actor, job.id, task.id, task.version, { bytes, fileName: download.fileName }, db); assert.equal(saved.state, "ready");
            assert.deepEqual(Buffer.from((await clients.dh.downloadAttachment(saved.attachmentId)).bytes), bytes);
        }
        assert.equal(await count(s.inboxAttachmentBlobs), 2);
        const noteId = Number(await targetId("messages", "qa-chat-open/qa-open-private")), [attachment] = await db.select().from(s.inboxAttachments).where(eq(s.inboxAttachments.messageId, noteId)); assert.equal(attachment.kind, "note");
    });
    await check("같은 원본 export 재이전과 완료 step 재시도는 고객·메시지·파일을 중복 생성하지 않음", async () => {
        const before = await counts(), next = await preview(fixture.bundle); assert.ok(next.rows.every(row => row.operation === "reuse"));
        await finish(next); await clients.dh.stepImport(completed.id, 0); assert.deepEqual(await counts(), before);
    });
    await check("미완료 추출·관계 누락·알 수 없는 상태는 실제 importer start 전에 차단", async () => {
        for (const mutate of [bundle => { bundle.hasNext = true; }, bundle => { bundle.users = []; }, bundle => { bundle.userChats[0].state = "future-fictional-state"; }]) {
            const bad = clone(fixture.bundle); mutate(bad); const before = await counts(), previewed = await preview(bad, { namespace: namespace + " invalid" }); assert.ok(previewed.errors.length > 0); await assert.rejects(start(previewed), error => error.status === 409); assert.deepEqual(await counts(), before);
        }
    });
    await check("명시 확인 member는 원본 회원 키를, 익명·미확인은 source namespace 키를 사용", async () => {
        for (const user of fixture.bundle.users) {
            const [contact] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, await targetId("contacts", user.id)));
            assert.equal(contact.externalId, user.type === "member" ? user.memberId : sourceExternalId("channel", namespace, "contacts", user.id));
            if (user.type !== "member") assert.notEqual(contact.externalId, user.memberId);
        }
    });
    await check("익명 veil 키와 기존 CRM 외부 키가 같아도 연결하지 않으며 확인 member의 link는 기존 필드 보존", async () => {
        const memberId = await targetId("contacts", "qa-user-a"), collision = await clients.dh.upsertContact({ workspaceId: 8, externalId: "qa-fictional-veil-gamma", name: "허구 기존 veil 충돌 CRM", email: "veil-collision@example.test" });
        await clients.dh.upsertContact({ workspaceId: 8, externalId: "qa-fictional-member-alpha", name: "허구 기존 CRM 회원명", attributes: { existingField: "preserved" } });
        const linked = await preview(fixture.bundle, { namespace: namespace + " existing link" }); assert.deepEqual(linked.errors, []);
        const member = linked.rows.find(row => row.kind === "contacts" && row.sourceId === "qa-user-a"), anonymous = linked.rows.find(row => row.kind === "contacts" && row.sourceId === "qa-user-c");
        assert.equal(member.operation, "link"); assert.equal(member.targetId, memberId); assert.equal(anonymous.operation, "create"); assert.notEqual(anonymous.targetId, collision.id);
        await finish(linked);
        const [saved] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, memberId)); assert.equal(saved.name, "허구 기존 CRM 회원명"); assert.equal(saved.attributes.existingField, "preserved");
        const linkedKeys = await db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.namespace, namespace + " existing link"), eq(s.customerImportObjects.kind, "conversations")));
        assert.equal(linkedKeys.length, 6); for (const key of linkedKeys) assert.equal((await repo.conversationDetail(actor, key.targetId, db)).conversation.historyOnly, true);
    });
    await check("source 분할 chunk를 백오피스랩 실제 importer에 순차 적용해 관계·중복·사업 경계 보존", async () => {
        const { splitChannelBundle } = require("../src/lib/channel-source-export/chunks.ts");
        const output = splitChannelBundle(fixture.bundle, { workspaceId: 10, namespace: namespace + " backoffice chunks", maxRows: 6 });
        assert.ok(output.chunks.length > 1); const before = await counts(), foreignMemberId = await targetId("contacts", "qa-user-a"); let linkedForeign = false;
        for (const chunk of output.chunks) {
            assert.ok(chunk.normalizedRows <= 6); let current = await clients.bo.previewImport(chunk.input); assert.deepEqual(current.errors, []);
            linkedForeign ||= current.rows.some(row => row.kind === "contacts" && row.targetId === foreignMemberId);
            current = await clients.bo.changeImport(current.id, { action: "start", version: current.version, fingerprint: current.fingerprint, acknowledge: true });
            while (current.state === "running") current = await clients.bo.stepImport(current.id, current.cursor);
            assert.equal(current.state, "completed", current.reason);
        }
        assert.equal(linkedForeign, false);
        const after = await counts(); assert.equal(after.crmContacts - before.crmContacts, 3); assert.equal(after.inboxConversations - before.inboxConversations, 6); assert.equal(after.inboxMessages - before.inboxMessages, 20); assert.equal(after.inboxAttachmentBlobs, before.inboxAttachmentBlobs);
        const [boMember] = await db.select().from(s.crmContacts).where(and(eq(s.crmContacts.workspaceId, 10), eq(s.crmContacts.externalId, "qa-fictional-member-alpha"))); assert.ok(boMember); assert.notEqual(boMember.id, await targetId("contacts", "qa-user-a"));
        const stable = await counts(); for (const chunk of output.chunks) { let next = await clients.bo.previewImport(chunk.input); assert.ok(next.rows.every(row => row.operation === "reuse")); next = await clients.bo.changeImport(next.id, { action: "start", version: next.version, fingerprint: next.fingerprint, acknowledge: true }); while (next.state === "running") next = await clients.bo.stepImport(next.id, next.cursor); assert.equal(next.state, "completed", next.reason); } assert.deepEqual(await counts(), stable);
    });
    if (!process.argv.includes("--import-only")) {
        const corePath = path.resolve(__dirname, "../src/lib/customer-imports/channel-export.ts");
        assert.ok(fs.existsSync(corePath), "Reviewed export core must be integrated before source phase. Use --import-only for the separately named importer phase.");
        const { exportChannelData, ChannelExportTransportError } = require(corePath);
        const options = (request, extra = {}) => ({ channelId: fixture.channelId, request, sleep: async () => {}, limits: { pageSize: 2, minRequestIntervalMs: 0, retryBaseMs: 1, retryMaxMs: 10, maxAttempts: 2 }, ...extra });
        let exported;
        await check("소스 GET 주입만으로 6상태·모든 메시지 커서·관련 고객·원본 raw를 완전 추출", async () => {
            const source = fakeSource(), checkpoints = [];
            exported = await exportChannelData(options(source.request, { checkpoint: async value => checkpoints.push(clone(value)) }));
            assert.equal(exported.status, "complete"); assert.equal(exported.bundle.hasNext, false);
            for (const kind of ["users", "managers", "bots", "userChats", "messages"]) assert.deepEqual([...exported.bundle[kind]].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [...fixture.bundle[kind]].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
            assert.equal(exported.counts.messages, 20); assert.equal(exported.counts.attachments, 2);
            assert.ok(Object.values(exported.checkpoint.ledger).every(entry => entry.status === "complete"));
            assert.deepEqual(new Set(source.calls.filter(call => call.path === "/open/user-chats").map(call => call.query.state)), new Set(fixture.states));
            assert.ok(source.calls.some(call => call.query.cursor === "page-2")); assert.ok(exported.limitations.some(value => /not all customers/.test(value))); assert.ok(checkpoints.length > 5);
            const before = await counts(), next = await preview(exported.bundle); assert.deepEqual(next.errors, []); assert.ok(next.rows.every(row => row.operation === "reuse")); await finish(next); assert.deepEqual(await counts(), before);
        });
        await check("request 상한으로 중단한 source는 incomplete·import 차단 후 checkpoint 재개", async () => {
            const source = fakeSource(), partial = await exportChannelData(options(source.request, { limits: { pageSize: 2, minRequestIntervalMs: 0, maxRequests: 3 } }));
            assert.equal(partial.status, "incomplete"); assert.equal(partial.bundle.hasNext, true); const failedPreview = await preview(partial.bundle); assert.ok(failedPreview.errors.length > 0); await assert.rejects(start(failedPreview), error => error.status === 409);
            const resumed = await exportChannelData(options(fakeSource().request, { resume: partial.checkpoint })); assert.equal(resumed.status, "complete"); assert.equal(resumed.counts.messages, 20);
        });
        await check("429·503·typed timeout 재시도는 같은 미커밋 페이지를 사용하고 원본 중복 없음", async () => {
            for (const failure of [429, 503, "timeout"]) {
                const source = fakeSource(), delays = []; let attempts = 0;
                const result = await exportChannelData(options(async request => { if (request.path === "/open/managers" && attempts++ === 0) { if (failure === "timeout") throw new ChannelExportTransportError("timeout"); return { status: failure, headers: { "retry-after": "0" } }; } return source.request(request); }, { sleep: async ms => delays.push(ms) }));
                assert.equal(result.status, "complete", String(failure)); assert.equal(result.counts.messages, 20); assert.equal(result.counts.managers, 1); assert.ok(delays.length > 0); assert.equal(attempts, 2);
            }
        });
        await check("메시지 cursor loop는 미완료 원본을 import-ready로 만들지 않음", async () => {
            const source = fakeSource();
            const result = await exportChannelData(options(async request => { const response = await source.request(request); if (request.path === "/open/user-chats/qa-chat-open/messages" && request.query.cursor === "page-2") return { ...response, body: { ...response.body, hasNext: true, nextCursor: "page-2" } }; return response; }));
            assert.equal(result.status, "failed"); assert.equal(result.checkpoint.failure.code, "cursor_loop"); assert.equal(result.bundle.hasNext, true); assert.equal(result.bundle.messages.length, 2); assert.ok((await preview(result.bundle)).errors.length > 0);
        });
        await check("같은 source ID의 변경된 페이지는 충돌 실패하고 이전 raw·커서를 보존", async () => {
            const source = fakeSource();
            const result = await exportChannelData(options(async request => { if (request.path === "/open/managers") return { status: 200, body: { managers: [{ ...clone(fixture.bundle.managers[0]), ...(request.query.cursor ? { name: "허구 충돌한 이름" } : {}) }], hasNext: !request.query.cursor, nextCursor: request.query.cursor ? null : "page-2" } }; return source.request(request); }));
            assert.equal(result.status, "failed"); assert.equal(result.checkpoint.failure.code, "conflicting_managers_id"); assert.equal(result.bundle.managers[0].name, fixture.bundle.managers[0].name); assert.equal(result.checkpoint.ledger.managers.cursor, "page-2"); assert.equal(result.bundle.hasNext, true);
        });
        await check("abort 후 완료된 메시지 페이지는 재수집하지 않고 다음 cursor부터 재개", async () => {
            const controller = new AbortController(), source = fakeSource();
            const result = await exportChannelData(options(source.request, { signal: controller.signal, checkpoint: async state => { if (state.ledger["messages:qa-chat-open"]?.pages === 1) controller.abort(); } }));
            assert.equal(result.status, "aborted"); assert.equal(result.bundle.hasNext, true); assert.equal(result.bundle.messages.length, 2);
            const resumeSource = fakeSource(), resumed = await exportChannelData(options(resumeSource.request, { resume: result.checkpoint })); assert.equal(resumed.status, "complete"); assert.equal(resumed.counts.messages, 20);
            assert.deepEqual(resumeSource.calls.filter(call => call.path === "/open/user-chats/qa-chat-open/messages").map(call => call.query.cursor), ["page-2"]);
            const next = await preview(resumed.bundle); assert.deepEqual(next.errors, []); assert.ok(next.rows.every(row => row.operation === "reuse"));
        });
    }
    assert.equal(forbiddenRequests, 0);
    console.log(`허구 Channel export ${process.argv.includes("--import-only") ? "importer 단계만" : "source→importer"} memory PGlite QA ${n}개 통과 · 실제 API/계정/고객 자료/외부 HTTP/서버 변경 0건 · 첨부 metadata와 bytes 별도 검증`);
    await pg.close();
}
require("./check-customer-platform.cjs").runPlatformCheck(scenario).catch(error => { console.error(error); process.exitCode = 1; });
