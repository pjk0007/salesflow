/* eslint-disable @typescript-eslint/no-require-imports -- 가상 자료·격리 PostgreSQL, 외부 전송 차단 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function main() {
    const { fixture } = require('./check-inbox.cjs');
    const { db, pg, actor, otherActor } = await fixture();
    const s = require('../src/lib/db/schema.ts');
    const { eq, sql } = require('drizzle-orm');
    const { conversationAcquisition, recordAcquisition, lookupAcquisition } = require('../src/lib/alert-acquisition/repository.ts');
    const realFetch = global.fetch;
    global.fetch = async () => { throw new Error('실제 네트워크 금지'); };
    const at = new Date('2026-11-04T09:00:00Z');
    const ago = seconds => new Date(at.getTime() - seconds * 1000);
    let checks = 0;
    const check = async (name, fn) => { await fn(); checks++; console.log('PASS '+name); };
    try {
        const [site] = await db.insert(s.trackerSites).values({ orgId: actor.orgId, workspaceId: 8, name: '가상', apiKey: 'fictional-only', domains: ['fictional.test'] }).returning();
        const [visitor] = await db.insert(s.trackerVisitors).values({ orgId: actor.orgId, siteId: site.id, visitorId: randomUUID(), recordId: 1, email: 'ryu@example.test' }).returning();
        const [send] = await db.insert(s.emailSendLogs).values({ orgId: actor.orgId, recordId: 1, recipientEmail: 'ryu@example.test', senderEmail: 'hello@domain2.test', sentAt: ago(600), status: 'sent' }).returning();
        const [click] = await db.insert(s.emailClickLogs).values({ orgId: actor.orgId, sendLogId: send.id, clickId: randomUUID(), url: 'https://fictional.test/', clickedAt: ago(65), isBot: false }).returning();
        const [session] = await db.insert(s.trackerSessions).values({ siteId: site.id, visitorId: visitor.id, sessionKey: randomUUID(), startedAt: ago(60), clickId: click.clickId }).returning();
        const scope = { orgId: actor.orgId, workspaceId: 8, at };
        const context = { kind: 'sendb-journey-context', orgId: actor.orgId, workspaceId: 8, siteId: site.id, visitorId: visitor.id, sessionId: session.id, origin: 'https://fictional.test', linkedAt: at.toISOString() };
        const chat = { orgId: actor.orgId, recordId: 1, email: 'ryu@example.test', journeyContext: context };
        const record = { ...scope, recordId: 1 };
        await check('같은 사업의 직접 클릭·상담 연결은 확인, 당시 발신 도메인 사용', async () => {
            assert.deepEqual(await conversationAcquisition(scope, chat, db), { channel: '메일 · domain2.test', certainty: 'confirmed', evidence: '메일 클릭과 상담 방문의 직접 연결 기록 있음' });
        });
        await check('접수와의 직접 연결이 없으면 같은 레코드·클릭·방문도 추정', async () => {
            assert.equal((await recordAcquisition(record, db)).certainty, 'inferred');
        });
        await check('다른 조직·사업의 레코드와 방문을 가져오지 않음', async () => {
            assert.equal((await recordAcquisition({ ...record, orgId: otherActor.orgId }, db)).certainty, 'unknown');
            assert.equal((await conversationAcquisition({ ...scope, workspaceId: 10 }, chat, db)).certainty, 'unknown');
        });
        await check('미래의 방문·클릭으로 과거 상담을 확정하지 않음', async () => {
            assert.equal((await conversationAcquisition({ ...scope, at: ago(120) }, chat, db)).certainty, 'unknown');
        });
        await check('상담 레코드와 클릭 대상이 충돌하면 확인하지 않음', async () => {
            assert.equal((await conversationAcquisition(scope, { ...chat, recordId: 2 }, db)).certainty, 'unknown');
        });
        await check('봇 클릭은 직접 메일 유입의 근거에서 제외', async () => {
            await db.update(s.emailClickLogs).set({ isBot: true }).where(eq(s.emailClickLogs.id, click.id));
            assert.equal((await conversationAcquisition(scope, chat, db)).certainty, 'unknown');
            await db.update(s.emailClickLogs).set({ isBot: false }).where(eq(s.emailClickLogs.id, click.id));
        });
        await check('직접 연결된 검색 방문은 확인, 같은 방문의 느슨한 접수 연결은 추정', async () => {
            await db.update(s.trackerSessions).set({ clickId: null, referrer: 'https://www.google.com/search?q=fictional' }).where(eq(s.trackerSessions.id, session.id));
            assert.equal((await conversationAcquisition(scope, chat, db)).channel, '홈페이지 · 구글 검색');
            assert.equal((await conversationAcquisition(scope, chat, db)).certainty, 'confirmed');
            assert.equal((await recordAcquisition(record, db)).certainty, 'inferred');
        });
        await check('발송·방문·이메일 단서만 일치하면 메일 유입 추정', async () => {
            await db.update(s.trackerSessions).set({ referrer: null }).where(eq(s.trackerSessions.id, session.id));
            assert.equal((await recordAcquisition(record, db)).channel, '메일 · domain2.test');
            assert.equal((await recordAcquisition(record, db)).certainty, 'inferred');
        });
        await check('발송 이력만 있고 방문이 없으면 유입 미확인', async () => {
            assert.equal((await recordAcquisition({ ...record, at: ago(120) }, db)).certainty, 'unknown');
        });
        await check('개인 이메일만 같아도 사업을 넘나들지 않음', async () => {
            assert.equal((await recordAcquisition({ ...scope, workspaceId: 10, recordId: null, email: 'ryu@example.test' }, db)).certainty, 'unknown');
        });
        await check('부가 조회 SQL 실패를 롤백하고 기존 알림에서 쓸 연결을 보존', async () => {
            const result = await lookupAcquisition(db, async tx => { await tx.execute(sql`SELECT fictional_missing_column`); return { channel: '잘못된 결과' }; });
            assert.equal(result.certainty, 'unknown');
            assert.equal((await recordAcquisition(record, db)).certainty, 'inferred');
        });
        console.log(JSON.stringify({ checks, database: 'isolated-pglite', externalMessages: 0 }));
    } finally { global.fetch = realFetch; await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
