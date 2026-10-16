/* eslint-disable @typescript-eslint/no-require-imports -- 가상 채널톡 원본·격리 API/SQL의 재이전 회귀 */
const assert = require("node:assert/strict"),
    { randomUUID, createHash } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");

async function scenario({ db, pg, clients, channels, dispatch }) {
    const s = require("../src/lib/db/schema.ts"),
        { eq } = require("drizzle-orm"),
        client = clients.dh,
        bytes = Buffer.from("%PDF-1.4\nFictional ChannelTalk migration\n%%EOF"),
        namespace = "channel-contact-reimport-qa",
        source = {
            users: Array.from({ length: 26 }, (_, i) => ({
                id: `user-${i}`,
                memberId: `channel-reimport-member-${i}`,
                profile: { name: `가상 원본 고객 ${i}`, email: `original-${i}@example.test` },
                createdAt: 1715000000000,
            })),
            userChats: [{
                id: "chat-0", userId: "user-0", name: "가상 원본 상담 제목",
                state: "closed", createdAt: 1715000000100,
            }],
            messages: [{
                id: "message-0", chatId: "chat-0", personId: "user-0", personType: "user",
                plainText: "가상 기존 문의", createdAt: 1715000000200,
                files: [{
                    key: "synthetic-file-key", name: "가상 원본.pdf", size: bytes.length,
                    sha256: createHash("sha256").update(bytes).digest("hex"),
                }],
            }],
        };
    let checks = 0, contactId, historyId, liveId, initial, original, file;
    const check = async (name, fn) => {
        await fn();
        console.log(`PASS CHANNEL REIMPORT ${++checks} ${name}`);
    };
    const rows = (table, column, id) => db.select().from(table).where(eq(column, id));
    const contact = async () => (await rows(s.crmContacts, s.crmContacts.id, contactId))[0];
    const chat = async (id) => (await rows(s.inboxConversations, s.inboxConversations.id, id))[0];
    const messages = () => rows(s.inboxMessages, s.inboxMessages.conversationId, historyId);
    const preview = (data = source) => client.previewImport({
        workspaceId: 8, source: "channel", namespace, format: "json",
        content: JSON.stringify(data), updateImported: true,
    });
    const start = (job) => client.changeImport(job.id, {
        action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true,
    });
    async function finish(job) {
        assert.deepEqual(job.errors, []);
        const cursors = [];
        let active = await start(job);
        while (active.state === "running" && cursors.length < 10) {
            active = await client.stepImport(active.id, active.cursor);
            cursors.push(active.cursor);
        }
        assert.equal(active.state, "completed", active.reason);
        assert.deepEqual(cursors, [25, 28]);
        return active;
    }
    const target = (job, kind) => job.results.find((r) =>
        r.position === job.rows.find((row) => row.kind === kind).index,
    ).targetId;
    async function preservedMessageAndFile() {
        const saved = await messages();
        assert.equal(saved.length, 1);
        assert.equal(saved[0].id, original.message.id);
        assert.equal(saved[0].clientId, original.message.clientId);
        assert.equal(saved[0].body, original.message.body);
        assert.deepEqual(saved[0].createdAt, original.message.createdAt);
        assert.deepEqual(saved[0].importMetadata.files, original.message.importMetadata.files);
        const tasks = await rows(s.customerImportFiles, s.customerImportFiles.messageId, saved[0].id);
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].id, file.id);
        assert.equal(tasks[0].attachmentId, file.attachmentId);
        assert.equal(tasks[0].state, "ready");
        const [attachment] = await rows(s.inboxAttachments, s.inboxAttachments.id, file.attachmentId);
        assert.equal(attachment.messageId, saved[0].id);
        assert.equal(saved[0].conversationId, historyId);
        assert.equal(attachment.channelId, channels.dh.id);
        assert.deepEqual(Buffer.from((await client.downloadAttachment(file.attachmentId)).bytes), bytes);
    }

    await check("26명·상담·메시지를 25행 경계를 넘어 처음 이전하고 가상 첨부를 보충", async () => {
        initial = await finish(await preview());
        contactId = target(initial, "contacts");
        historyId = target(initial, "conversations");
        const task = (await client.importFiles(initial.id)).rows[0];
        file = await client.uploadImportFile(initial.id, task.id, task.version, new Blob([bytes]), "가상 원본.pdf");
        original = { chat: await chat(historyId), message: (await messages())[0] };
        assert.equal(original.chat.name, source.userChats[0].name);
        assert.equal(original.chat.createdAt.getTime(), source.userChats[0].createdAt);
        await preservedMessageAndFile();
        const identity = await client.customerIdentity(channels.dh.id, contactId);
        const sent = await dispatch(`http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${identity.identityToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: randomUUID(), body: "가상 현재 상담" }),
        });
        assert.equal(sent.status, 200);
        liveId = (await client.conversations(channels.dh.id)).find((c) => c.contactId === contactId).id;
        assert.equal((await chat(liveId)).historyOnly, false);
    });
    await check("동일 원본 재이전은 기존 상담·메시지·파일을 중복 없이 재사용", async () => {
        const repeated = await finish(await preview());
        assert.equal(target(repeated, "contacts"), contactId);
        assert.equal(target(repeated, "conversations"), historyId);
        assert.deepEqual(await chat(historyId), original.chat);
        await preservedMessageAndFile();
    });
    await check("고객 이름·이메일 갱신은 다른 묶음의 과거 상담을 훼손하지 않고 완료", async () => {
        source.users[0].profile = { name: "가상 원본 고객 변경", email: "updated@example.test" };
        const plan = await preview();
        assert.equal(plan.rows[0].operation, "update");
        assert.equal(plan.rows[26].operation, "reuse");
        await finish(plan);
        assert.equal((await contact()).name, source.users[0].profile.name);
        assert.equal((await contact()).email, source.users[0].profile.email);
        assert.equal((await chat(liveId)).name, source.users[0].profile.name);
        assert.equal((await chat(liveId)).email, source.users[0].profile.email);
        assert.deepEqual(await chat(historyId), original.chat);
        await preservedMessageAndFile();
    });
    await check("같은 작업에서 고객과 상담 원본을 함께 갱신하면 부모 결과의 새 지문 사용", async () => {
        source.users[0].profile = { name: "가상 원본 고객 재변경", email: "updated-again@example.test" };
        source.userChats[0].name = "가상 원본에서 바꾼 상담 제목";
        await finish(await preview());
        const historic = await chat(historyId);
        assert.equal(historic.name, source.userChats[0].name);
        assert.equal(historic.email, source.users[0].profile.email);
        assert.equal(historic.importMetadata.customerName, source.users[0].profile.name);
        assert.deepEqual(historic.createdAt, original.chat.createdAt);
        await preservedMessageAndFile();
    });
    await check("처리 묶음 사이에 사용자가 부모 고객을 수정하면 다음 상담 갱신 차단", async () => {
        const pendingSource = structuredClone(source), historical = await chat(historyId);
        pendingSource.users[0].profile.name = "가상 원본의 세 번째 갱신";
        pendingSource.userChats[0].name = "실행 중 직접 편집 후 저장되면 안 되는 제목";
        const plan = await preview(pendingSource);
        assert.deepEqual(plan.errors, []);
        let active = await start(plan);
        active = await client.stepImport(active.id, active.cursor);
        assert.equal(active.state, "running");
        assert.equal(active.cursor, 25);
        const current = await contact();
        await client.upsertContact({
            workspaceId: 8, externalId: current.externalId, name: "가상 묶음 사이 직접 수정",
            version: current.version,
        });
        active = await client.stepImport(active.id, active.cursor);
        assert.equal(active.state, "failed");
        assert.equal(active.cursor, 25);
        assert.match(active.reason, /연결할 contacts 자료가 검토 이후 바뀌었습니다/);
        assert.equal((await contact()).name, "가상 묶음 사이 직접 수정");
        assert.deepEqual(await chat(historyId), historical);
        await preservedMessageAndFile();
    });
    await check("CRM recordId 연결은 현재 상담에만 전파하고 과거 원본은 유지", async () => {
        const historical = await chat(historyId), current = await contact();
        await client.upsertContact({
            workspaceId: 8, externalId: current.externalId, name: current.name,
            recordId: 1, version: current.version,
        });
        assert.equal((await chat(liveId)).recordId, 1);
        assert.deepEqual(await chat(historyId), historical);
    });
    await check("샌드비에서 직접 수정한 고객은 새 원본이 덮어쓰지 못함", async () => {
        const current = await contact(), historical = await chat(historyId);
        await client.upsertContact({
            workspaceId: 8, externalId: current.externalId, name: "가상 사용자 직접 수정",
            email: "local-edit@example.test", version: current.version,
        });
        const pendingSource = structuredClone(source);
        pendingSource.users[0].profile.name = "이 값으로 덮어쓰면 안 됨";
        const blocked = await preview(pendingSource);
        assert.ok(blocked.errors.some((e) => e.includes("이전 후 샌드비에서 수정")));
        await assert.rejects(start(blocked), (e) => e.status === 409);
        assert.equal((await contact()).name, "가상 사용자 직접 수정");
        assert.equal((await chat(liveId)).name, "가상 사용자 직접 수정");
        assert.deepEqual(await chat(historyId), historical);
        await preservedMessageAndFile();
    });
    console.log(`채널톡 고객 재이전 SQL/API QA ${checks}개 통과 · 실제 DB/외부 요청 0건`);
    await pg.close();
}
if (require.main === module) {
    global.fetch = async () => { throw new Error("외부 요청 금지: 격리 채널톡 재이전 검사"); };
    runPlatformCheck(scenario).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
module.exports = { scenario };
