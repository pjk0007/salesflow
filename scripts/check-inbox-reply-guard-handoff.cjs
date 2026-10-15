/* eslint-disable @typescript-eslint/no-require-imports -- 가상 PGlite의 고객 이관/작성 잠금 회귀 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");

async function scenario(ctx) {
    const { db, pg, actor, channels, clients, repo, dispatch, aiTest } = ctx,
        s = require("../src/lib/db/schema.ts"),
        { eq, sql } = require("drizzle-orm"),
        guard = require("../src/lib/inbox-reply-guard/repository.ts"),
        files = require("../src/lib/inbox/files.ts");
    const channel = channels.dh,
        failures = [];
    let checked = 0,
        passed = false;
    const rows = (table, column, id) =>
        db.select().from(table).where(eq(column, id));
    const chat = async (id) =>
        (await rows(s.inboxConversations, s.inboxConversations.id, id))[0];
    const count = async (table) =>
        (await db.select({ n: sql`count(*)`.mapWith(Number) }).from(table))[0].n;
    const send = async (visitor, input) => {
        const response = await dispatch(
            `http://127.0.0.1:3120/api/messenger/${channel.publicKey}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${visitor.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(input),
            },
        );
        return { status: response.status, value: await response.json() };
    };
    try {
        aiTest.configured = true;
        const knowledge = await clients.dh.createSupportKnowledge(
            8,
            "가상 고객 이관 검사 지식",
            {
                businessName: "가상 디하",
                claims: [{
                    text: "가상 디자인 구독 요금은 월 150,000원입니다.",
                    sourceUrl: "https://example.test/handoff-faq",
                    checkedAt: new Date(Date.now() - 1000).toISOString(),
                    purposes: ["customer_chat"],
                }],
            },
        );
        await clients.dh.reviewSupportKnowledge(8, knowledge.id, "approve");
        const settings = await clients.dh.supportAiSettings(8);
        await clients.dh.updateSupportAiSettings(8, {
            ...settings.settings,
            knowledgeVersionId: knowledge.id,
            mode: "reply",
        });
        const configured = await clients.dh.replyGuard(channel.id);
        await clients.dh.saveReplyGuard({
            channelId: channel.id,
            version: configured.version,
            enabled: true,
        });

        for (const writing of [true, false]) {
            for (const attachment of [false, true]) {
                const name = `${writing ? "직원 작성 중" : "작성자 없음"} · ${attachment ? "첨부 문의" : "상담원 요청"}`;
                try {
                    const visitor = await repo.startVisitorSession(
                        channel.publicKey,
                        { name: "가상 이관 고객" },
                        db,
                    );
                    const initial = await send(visitor, {
                        clientId: randomUUID(),
                        body: "가상 디자인 구독 요금이 궁금합니다.",
                    });
                    assert.equal(initial.status, 200);
                    const before = await chat(visitor.id),
                        sessionId = randomUUID();
                    let lease;
                    if (writing) {
                        const page = await guard.updateReplyLease(actor, {
                            action: "acquire",
                            conversationId: visitor.id,
                            sessionId,
                            revision: before.replyRevision,
                        }, db);
                        lease = page.conversation.lease;
                    }
                    const bytes = Buffer.from("%PDF-1.4 fictional handoff file"),
                        scope = await repo.visitorFileScope(channel.publicKey, visitor.token, db);
                    const uploaded = attachment
                        ? await files.uploadAttachment(scope, {
                            clientId: randomUUID(),
                            kind: "customer",
                            fileName: "handoff.pdf",
                            bytes,
                        }, db)
                        : null;
                    const input = {
                        clientId: randomUUID(),
                        body: attachment ? "문의 자료를 첨부합니다." : "상담원 연결 부탁드립니다.",
                        attachmentIds: uploaded ? [uploaded.id] : [],
                    };
                    const sent = await send(visitor, input);
                    if (sent.status !== 200) {
                        const stored = await rows(s.inboxMessages, s.inboxMessages.conversationId, visitor.id),
                            state = await chat(visitor.id);
                        const bound = uploaded
                            ? (await rows(s.inboxAttachments, s.inboxAttachments.id, uploaded.id))[0].messageId
                            : null;
                        console.log(`REPRO HANDOFF ${name}: HTTP ${sent.status}, customerMessages=${stored.filter(m => m.kind === "customer").length}, aiState=${state.aiState}, attachmentMessageId=${bound}, error=${sent.value.error}`);
                    }
                    assert.equal(sent.status, 200, sent.value.error);
                    const messageId = sent.value.data.id,
                        stored = await rows(s.inboxMessages, s.inboxMessages.conversationId, visitor.id),
                        current = await chat(visitor.id);
                    assert.equal(stored.filter(m => m.kind === "customer").length, 2);
                    assert.equal(stored.filter(m => m.kind === "reply").length, writing ? 0 : 1);
                    assert.equal(current.aiState, "human");
                    assert.equal(current.replyRevision, before.replyRevision + (writing ? 1 : 2));
                    if (lease) {
                        const page = await guard.replyGuardPage(actor, channel.id, visitor.id, sessionId, db);
                        assert.equal(page.conversation.lease.id, lease.id);
                        assert.equal(page.conversation.lease.isMine, true);
                        assert.equal(page.conversation.lease.baseRevision, lease.baseRevision);
                        assert.equal(page.conversation.lease.expiresAt, lease.expiresAt);
                    }
                    if (uploaded) {
                        const saved = (await rows(s.inboxAttachments, s.inboxAttachments.id, uploaded.id))[0];
                        assert.equal(saved.messageId, messageId);
                        assert.deepEqual((await files.downloadAttachment(scope, uploaded.id, db)).bytes, bytes);
                    }
                    const eventCount = await count(s.platformEvents),
                        retried = await send(visitor, input);
                    assert.equal(retried.status, 200);
                    assert.deepEqual(retried.value.data, sent.value.data);
                    assert.equal((await rows(s.inboxMessages, s.inboxMessages.conversationId, visitor.id)).length, stored.length);
                    assert.equal(await count(s.platformEvents), eventCount);
                    console.log(`PASS HANDOFF ${++checked} ${name} · 고객 저장/이관/첨부/잠금/안내/멱등 확인`);
                } catch (error) {
                    failures.push({ name, error });
                    console.error(`FAIL HANDOFF ${name}: ${error.message}`);
                }
            }
        }
        assert.equal(failures.length, 0, failures.map(f => f.name).join(", "));
        console.log(`고객 이관/답변 잠금 PGlite QA ${checked}개 통과 · 가상 고객 전용 · 실제 DB/모델/외부 전송 없음`);
        passed = true;
    } finally {
        // runPlatformCheck closes failed scenarios; avoid hiding their assertion.
        if (passed) await pg.close();
    }
}

const originalFetch = global.fetch;
global.fetch = async () => { throw new Error("실제 네트워크 사용 금지"); };
runPlatformCheck(scenario)
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => { global.fetch = originalFetch; });
