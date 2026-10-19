/* eslint-disable @typescript-eslint/no-require-imports -- 격리 SQL과 가상 고객만 사용하며 외부 발송을 차단한다. */
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module');
const { randomUUID } = require('node:crypto');
async function main() {
    const { fixture } = require('./check-inbox.cjs');
    const ctx = await fixture(), { db, pg, actor } = ctx;
    const schema = require('../src/lib/db/schema.ts'), { eq } = require('drizzle-orm');
    const realFetch = global.fetch; global.fetch = async () => { throw Error('실제 네트워크 사용 금지'); };
    const originalLoad = Module._load;
    Module._load = function(name, parent) {
        const resolved = Module._resolveFilename(name, parent).replaceAll('\\', '/');
        if (resolved.endsWith('/src/lib/db/index.ts')) return { ...schema, db };
        return originalLoad.apply(this, arguments);
    };
    const { enqueueInboxChatAlert } = require('../src/lib/inbox-chat-alerts/enqueue.ts');
    const { processInboxChatAlerts } = require('../src/lib/inbox-chat-alerts/worker.ts');
    Module._load = originalLoad;
    let checks = 0;
    const check = async (name, action) => { await action(); checks++; console.log('PASS ' + name); };
    try {
        await pg.exec(fs.readFileSync('drizzle/0117_inbox_chat_alerts.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
        // Applying the additive migration twice must be safe.
        await pg.exec(fs.readFileSync('drizzle/0117_inbox_chat_alerts.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
        const [channel] = await db.insert(schema.inboxChannels).values({ orgId: actor.orgId, workspaceId: 8, publicKey: 'chat-alert-fixture', name: '가상 디하', enabled: true }).returning();
        const [otherChannel] = await db.insert(schema.inboxChannels).values({ orgId: actor.orgId, workspaceId: 10, publicKey: 'other-chat-alert-fixture', name: '가상 백오랩', enabled: true }).returning();
        const route = { orgId: actor.orgId, workspaceId: 8, channelId: channel.id, webhook: 'https://chat.googleapis.com/v1/spaces/fake/messages?key=fake&token=fake' };
        const configure = (value = route) => { process.env.INBOX_CHAT_ALERTS = 'on'; process.env.INBOX_CHAT_ALERT_ROUTES = JSON.stringify([value]); delete process.env.NEXT_PUBLIC_APP_URL; };
        const make = async (options = {}) => {
            const channelId = options.channelId ?? channel.id;
            const [chat] = await db.insert(schema.inboxConversations).values({ orgId: actor.orgId, channelId, tokenHash: randomUUID().replaceAll('-', '').repeat(2), name: '가상 고객', historyOnly: options.historyOnly ?? false, contactId: options.contactId ?? null }).returning();
            const [message] = await db.insert(schema.inboxMessages).values({ conversationId: chat.id, clientId: randomUUID(), kind: options.kind ?? 'customer', body: options.body ?? '안녕하세요.\n원문 <그대로> & 줄바꿈 확인🙂', authorName: '가상 고객', importMetadata: options.importMetadata ?? null }).returning();
            const event = { type: 'message.created', orgId: actor.orgId, workspaceId: channelId === channel.id ? 8 : 10, payload: { data: { conversationId: chat.id, message: { id: message.id } } } };
            await db.transaction(tx => enqueueInboxChatAlert(tx, event));
            return { chat, message, event };
        };
        const rows = () => db.select().from(schema.inboxChatAlertDeliveries);
        let first;
        await check('off 상태·기존 고객 메시지는 자동으로 과거 발송하지 않음', async () => { process.env.INBOX_CHAT_ALERTS = 'off'; await make(); assert.equal((await rows()).length, 0); });
        configure();
        await check('새 고객 메시지는 원문 저장과 같은 트랜잭션에 한 번만 대기', async () => { first = await make(); await enqueueInboxChatAlert(db, first.event); assert.equal((await rows()).length, 1); });
        await check('다른 사업·내부 메모·직원 답장·과거 수입 메시지는 제외', async () => { for (const options of [{ channelId: otherChannel.id }, { kind: 'note' }, { kind: 'reply' }, { historyOnly: true }, { importMetadata: { source: 'archive' } }]) await make(options); assert.equal((await rows()).length, 1); });
        await check('내부자 고객은 제외', async () => { const [contact] = await db.insert(schema.crmContacts).values({ orgId: actor.orgId, workspaceId: 8, externalId: randomUUID(), name: '가상 내부자', isInternal: true }).returning(); await make({ contactId: contact.id }); assert.equal((await rows()).length, 1); });
        await check('원본 트랜잭션 롤백 시 알림 대기도 롤백', async () => { const next = await make(); await db.delete(schema.inboxChatAlertDeliveries).where(eq(schema.inboxChatAlertDeliveries.messageId, next.message.id)); await assert.rejects(db.transaction(async tx => { await enqueueInboxChatAlert(tx, next.event); throw Error('rollback'); })); assert.equal((await rows()).length, 1); });
        await check('원문·상담 링크가 전달되고 성공 시 재발송하지 않음', async () => { const calls = []; const send = async (...args) => { calls.push(args); return { ok: true }; }; assert.equal((await processInboxChatAlerts({ exec: db, send, baseUrl: 'https://sendb.kr' })).sent, 1); await processInboxChatAlerts({ exec: db, send }); assert.equal(calls.length, 1); assert.match(JSON.stringify(calls[0][1]), /원문 &lt;그대로&gt; &amp;/); assert.match(JSON.stringify(calls[0][1]), /message=/); assert.equal((await rows())[0].state, 'sent'); });
        await check('실제 메시지 저장 경로가 알림 대기를 함께 만들며 중복 제출을 보존', async () => {
            const repo = require('../src/lib/inbox/repository.ts');
            const input = { clientId: randomUUID(), kind: 'customer', body: '가상 원문 저장 경로 검수', authorName: '가상 고객', attachmentIds: [] };
            const scope = { orgId: actor.orgId, channelId: channel.id, conversationId: first.chat.id, ownerKey: 'fixture', publicOnly: false };
            const before = (await rows()).length;
            await repo.appendMessage(db, first.chat.id, input, scope);
            await repo.appendMessage(db, first.chat.id, input, scope);
            assert.equal((await rows()).length, before + 1);
            assert.equal((await processInboxChatAlerts({ exec: db, send: async () => ({ ok: true }) })).sent, 1);
        });
        await check('두 워커가 같은 원문을 동시에 보내지 않음', async () => {
            await make(); let signalStarted, release;
            const started = new Promise(resolve => { signalStarted = resolve; });
            const gate = new Promise(resolve => { release = resolve; }); let count = 0;
            const send = async () => { count++; signalStarted(); await gate; return { ok: true }; };
            const firstWorker = processInboxChatAlerts({ exec: db, send, limit: 1 });
            await started;
            assert.equal((await processInboxChatAlerts({ exec: db, send, limit: 1 })).sent, 0);
            release(); assert.equal((await firstWorker).sent, 1); assert.equal(count, 1);
        });
        await check('긴 원문 부분 실패 후 성공한 부분을 반복하지 않음', async () => {
            const long = await make({ body: '한글🙂<&\n'.repeat(2200) }); let now = new Date(), calls = [];
            const send = async (_url, _payload, _fetch, opts) => { calls.push(opts.requestId); return calls.length === 2 ? { ok: false, status: 503, error: '가상 일시 오류', retryable: true } : { ok: true }; };
            await processInboxChatAlerts({ exec: db, send, now: () => now, limit: 1 });
            const [pending] = await db.select().from(schema.inboxChatAlertDeliveries).where(eq(schema.inboxChatAlertDeliveries.messageId, long.message.id));
            assert.equal(pending.state, 'retry'); assert.equal(pending.sentParts, 1);
            now = new Date(now.getTime() + 60000); const firstRequest = calls[0], failedRequest = calls[1];
            await processInboxChatAlerts({ exec: db, send, now: () => now });
            assert.equal(calls.filter(id => id === firstRequest).length, 1); assert.equal(calls.filter(id => id === failedRequest).length, 2);
            assert.equal((await db.select().from(schema.inboxChatAlertDeliveries).where(eq(schema.inboxChatAlertDeliveries.messageId, long.message.id)))[0].state, 'sent');
        });
        await check('설정이 다른 스페이스로 바뀌면 대기 중 원문을 보내지 않음', async () => { const next = await make(); configure({ ...route, webhook: route.webhook.replace('/fake/', '/changed/') }); let sent = false; await processInboxChatAlerts({ exec: db, send: async () => { sent = true; return { ok: true }; } }); assert.equal(sent, false); assert.equal((await db.select().from(schema.inboxChatAlertDeliveries).where(eq(schema.inboxChatAlertDeliveries.messageId, next.message.id)))[0].state, 'cancelled'); configure(); });
        await check('확정된 거절은 실패로 남기고 무한 재시도하지 않음', async () => { const next = await make(); let count = 0; const send = async () => { count++; return { ok: false, status: 403, error: '가상 접근 거절', retryable: false }; }; await processInboxChatAlerts({ exec: db, send }); await processInboxChatAlerts({ exec: db, send }); assert.equal(count, 1); assert.equal((await db.select().from(schema.inboxChatAlertDeliveries).where(eq(schema.inboxChatAlertDeliveries.messageId, next.message.id)))[0].state, 'dead'); });
        await check('발송 전 고객이 내부자로 바뀌면 전달을 취소', async () => { const next = await make(); const [contact] = await db.insert(schema.crmContacts).values({ orgId: actor.orgId, workspaceId: 8, externalId: randomUUID(), name: '내부 확인', isInternal: true }).returning(); await db.update(schema.inboxConversations).set({ contactId: contact.id }).where(eq(schema.inboxConversations.id, next.chat.id)); let sent = false; await processInboxChatAlerts({ exec: db, send: async () => { sent = true; return { ok: true }; } }); assert.equal(sent, false); });
        await check('개발 서버 설정이면 대기열이 생기지 않음', async () => { process.env.NEXT_PUBLIC_APP_URL = 'https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app'; const count = (await rows()).length; await make(); assert.equal((await rows()).length, count); });
        console.log(JSON.stringify({ checks, externalMessages: 0, database: 'isolated-pglite', migrationReapplied: true }));
    } finally { global.fetch = realFetch; Module._load = originalLoad; delete process.env.INBOX_CHAT_ALERTS; delete process.env.INBOX_CHAT_ALERT_ROUTES; await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
