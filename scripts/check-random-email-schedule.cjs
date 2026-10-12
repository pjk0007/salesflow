/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS 격리 검사에서 모듈 경계를 주입한다. */
/*
 * 격리된 Postgres와 가짜 AI/NHN으로 실제 준비·전송 경로를 검사한다. 외부 네트워크는 차단한다.
 * npm install --prefix .testenv/test-runtime --no-save --no-package-lock @electric-sql/pglite@0.5.8
 * node --import tsx scripts/check-random-email-schedule.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
process.env.DATABASE_URL = 'postgresql://isolated@127.0.0.1:1/isolated';
const pgliteRuntime = require(path.join(root, '.testenv/test-runtime/node_modules/@electric-sql/pglite'));
const { PGlite } = pgliteRuntime;
const { drizzle } = (() => {
  const load = Module._load;
  Module._load = function(request) { return request === '@electric-sql/pglite' ? pgliteRuntime : load.apply(this, arguments); };
  try { return require('drizzle-orm/pglite'); } finally { Module._load = load; }
})();
const { PgDialect, getTableConfig } = require('drizzle-orm/pg-core');
const { SQL, eq } = require('drizzle-orm');
const schema = require('../src/lib/db/schema.ts');
const dialect = new PgDialect();
const realDate = Date;
let clock = realDate.parse('2026-10-12T08:00:00+09:00');
const print = console.log.bind(console);
const errors = console.error.bind(console);
const state = { generated: 0, researched: 0, requests: [], followups: [], aiReady: true, quotaAllowed: true, unsubscribe: false, replied: false, held: false, throwSend: false };

function ddl(table) {
  const config = getTableConfig(table);
  const literal = (v) => typeof v === 'number' || typeof v === 'boolean' ? String(v)
    : `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
  const columns = config.columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${c.notNull ? ' NOT NULL' : ''}${c.default === undefined ? '' : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : literal(c.default)}`}`);
  for (const pk of config.primaryKeys) columns.push(`PRIMARY KEY (${pk.columns.map((c) => `"${c.name}"`).join(',')})`);
  return `CREATE TABLE "${config.name}" (${columns.join(',')});`;
}

async function main() {
  const pg = new PGlite();
  await pg.waitReady;
  const database = drizzle(pg, { schema });
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const overrides = new Map();
  const key = (filename) => path.resolve(filename).toLowerCase();
  const source = (name) => require.resolve(path.join(root, 'src/lib', name));
  const override = (name, exports) => overrides.set(key(source(name)), exports);
  const bridge = (db, transaction = false) => new Proxy(db, { get(target, name) {
    if (name === 'execute') return async (query) => {
      if (transaction) return (await target.execute(query)).rows;
      const compiled = dialect.sqlToQuery(query.getSQL());
      const sql = compiled.sql.replace(/\bNOW\(\)/gi, `'${new realDate(clock).toISOString()}'::timestamptz`);
      return (await pg.query(sql, compiled.params)).rows;
    };
    if (name === 'transaction') return (callback) => target.transaction((tx) => callback(bridge(tx, true)));
    const value = Reflect.get(target, name);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    for (const table of [schema.organizations, schema.partitions, schema.records, schema.emailAutoPersonalizedLinks, schema.emailSenderProfiles, schema.emailSenderDailyUsage, schema.emailSendQueue, schema.emailSendLogs]) await pg.exec(ddl(table));
    await pg.exec(fs.readFileSync(path.join(root, 'drizzle/0078_email_prepared_sends.sql'), 'utf8'));
    await pg.exec('CREATE UNIQUE INDEX esq_record_trigger_idx ON email_send_queue(record_id,trigger_type)');
    global.Date = class extends realDate {
      constructor(value) { super(arguments.length ? value : clock); }
      static now() { return clock; }
    };
    global.fetch = async () => { throw new Error('외부 네트워크 차단: 격리된 검사입니다.'); };
    console.log = () => {};
    console.error = () => {};
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      return overrides.get(key(resolved)) ?? originalLoad.apply(this, arguments);
    };
    const conn = async (strings, ...params) => {
      const sql = strings.reduce((text, part, i) => text + part + (i < params.length ? `$${i + 1}` : ''), '');
      return (await pg.query(sql, params)).rows;
    };
    conn.release = () => {};
    override('db', { ...schema, db: bridge(database), queryClient: { reserve: async () => conn } });
    override('ai', {
      getAiClient: () => state.aiReady ? { provider: 'fake', model: 'fake' } : null,
      getSearchAiClient: () => ({ provider: 'fake', model: 'fake-search' }),
      generateCompanyResearch: async () => { state.researched++; return { summary: '가상 회사 조사', sources: [], usage: { promptTokens: 1, completionTokens: 1 } }; },
      checkTokenQuota: async () => ({ allowed: state.quotaAllowed }),
      generateEmail: async () => { state.generated++; return { subject: `가상 메일 ${state.generated}`, htmlBody: '<p>격리된 테스트</p>', usage: { promptTokens: 1, completionTokens: 1 } }; },
      updateTokenUsage: async () => {}, logAiUsage: async () => {},
    });
    override('ai/company-research-cache', { findCachedCompanyResearch: async () => null });
    override('nhn-email', {
      getEmailConfig: async () => null,
      getEmailClient: async () => ({ sendEachMail: async (request) => {
        state.requests.push({ at: clock, request });
        if (state.throwSend) throw new Error('가상 전송 결과 불명확');
        return { header: { isSuccessful: true }, data: { requestId: `fake-${state.requests.length}`, results: [{ resultCode: 0 }] } };
      } }),
      appendSignature: (body) => body,
    });
    const resolver = require('../src/lib/email-sender-resolver.ts');
    override('email-sender-resolver', { ...resolver, resolveSignature: async () => null });
    override('email-unsubscribe', {
      resolveWorkspaceId: async () => 1, isUnsubscribed: async () => state.unsubscribe,
      generateUnsubscribeToken: () => 'test-token', buildUnsubscribeUrl: () => 'https://example.invalid/unsubscribe',
      appendUnsubscribeFooter: (body) => body, buildListUnsubscribeHeaders: () => ({}),
    });
    override('email-reply-guard', { findReplyStop: async () => state.replied ? { reason: 'replied' } : null });
    override('partition-hold', { getActiveHold: async () => state.held ? { id: 1 } : null, reviveOrphanHeldRows: async () => 0 });
    override('email-followup', { enqueueFollowup: async (input) => { state.followups.push(input); } });
    override('email-click-tracking', { wrapTrackingUrls: (body, id) => `${body}<!--log:${id}-->` });

    const orgId = '00000000-0000-4000-8000-000000000001';
    await database.insert(schema.organizations).values({ id: orgId, name: '가상 조직', slug: 'isolated' });
    await database.insert(schema.partitions).values({ id: 1, workspaceId: 1, name: '가상 명단' });
    await database.insert(schema.emailSenderProfiles).values([1, 2].map((id) => ({ id, orgId, name: `시험 ${id}`, fromName: '시험', fromEmail: `sender${id}@example.invalid`, dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 18, spreadEvenly: true })));
    await database.insert(schema.emailAutoPersonalizedLinks).values({ id: 1, orgId, partitionId: 1, recipientField: 'email', companyField: 'company', autoResearch: 1, senderProfileIds: [1, 2], preventDuplicate: 1, followupConfig: { delayDays: 3 } });
    const recordValues = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, orgId, workspaceId: 1, partitionId: 1, data: { email: `person${i + 1}@example.invalid`, company: '가상 회사' } }));
    await database.insert(schema.records).values(recordValues);
    await database.insert(schema.emailSendQueue).values(recordValues.map((r) => ({ id: r.id, recordId: r.id, orgId, partitionId: 1, triggerType: 'on_create' })));
    const { processAutoPersonalizedEmail } = require('../src/lib/auto-personalized-email.ts');
    const { processEmailSendQueue } = require('../src/lib/email-send-queue.ts');
    const processRecord = async (id) => {
      const [record] = await database.select().from(schema.records).where(eq(schema.records.id, id));
      return processAutoPersonalizedEmail({ queueId: id, record, orgId, partitionId: 1, triggerType: 'on_create', purpose: 'bulk' });
    };

    // 실제 큐 워커로 1,000건을 준비한다. 하루 총 20건만 작성하고 실제 전송·사용량 소비는 하지 않는다.
    const preparation = await processEmailSendQueue();
    assert.equal(preparation.failed, 0);
    assert.equal(state.generated, 20);
    assert.equal(state.researched, 20);
    assert.equal(state.requests.length, 0);
    assert.equal(state.followups.length, 0);
    assert.equal((await database.select().from(schema.emailSenderDailyUsage)).length, 0);
    const prepared = await database.select().from(schema.emailPreparedSends);
    assert.equal(prepared.length, 20);
    assert.ok(prepared.every((r) => r.payload && r.status === 'ready'));
    print('PASS 1,000건 업로드 → 주소별 10건 준비·예약, 나머지 다음 날 대기, 즉시 전송 0건');

    const due = prepared.sort((a, b) => a.scheduledAt - b.scheduledAt);
    clock = due[0].scheduledAt.getTime() - 1;
    await processEmailSendQueue({ deliveryOnly: true });
    assert.equal(state.requests.length, 0);
    state.aiReady = false;
    state.quotaAllowed = false;
    for (const item of due) {
      clock = item.scheduledAt.getTime() + 1000;
      const result = await processEmailSendQueue({ deliveryOnly: true });
      assert.equal(result.failed, 0);
    }
    assert.equal(state.requests.length, 20);
    assert.equal(state.generated, 20);
    assert.equal(state.researched, 20);
    assert.equal(state.followups.length, 20);
    assert.deepEqual((await database.select().from(schema.emailSenderDailyUsage)).map((r) => r.sentCount).sort(), [10, 10]);
    await processRecord(due[0].queueId);
    assert.equal(state.requests.length, 20);
    print('PASS 예약 전 전송 0건, AI·쿼터 없이 저장 본문 20건 전송, 사용량·후속 예약은 실제 전송 시 반영, 재실행 중복 0건');

    clock = realDate.parse('2026-10-13T08:00:00+09:00');
    state.aiReady = true;
    state.quotaAllowed = true;
    await processEmailSendQueue();
    const tomorrow = (await database.select().from(schema.emailPreparedSends)).filter((r) => r.usageDate === '2026-10-13');
    assert.equal(tomorrow.length, 20);
    assert.equal(state.generated, 40);
    assert.notDeepEqual(tomorrow.map((r) => r.scheduledAt.getTime() % 86400000).sort(), due.map((r) => r.scheduledAt.getTime() % 86400000).sort());
    print('PASS 다음 날 새 할당량 20건, 전날과 다른 예약 시각');

    const item = tomorrow.sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    clock = item.scheduledAt.getTime() + 10 * 60 * 1000;
    const before = state.requests.length;
    await processRecord(item.queueId);
    assert.equal(state.requests.length, before);
    assert.equal(state.generated, 40);
    const [rescheduled] = await database.select().from(schema.emailPreparedSends).where(eq(schema.emailPreparedSends.id, item.id));
    assert.ok(rescheduled.status === 'cancelled' || rescheduled.scheduledAt.getTime() > clock);
    print('PASS 오래 밀린 예약은 즉시 몰아 보내지 않고 저장 본문을 재사용해 미래로 재배정');

    const candidate = tomorrow.find((r) => r.id !== item.id);
    clock = candidate.scheduledAt.getTime() + 1000;
    state.unsubscribe = true;
    await processRecord(candidate.queueId);
    assert.equal(state.requests.length, before);
    const [cancelled] = await database.select().from(schema.emailPreparedSends).where(eq(schema.emailPreparedSends.id, candidate.id));
    assert.equal(cancelled.status, 'cancelled');
    state.unsubscribe = false;
    print('PASS 준비 후 수신거부한 고객은 전송하지 않고 예약 해제');

    const uncertain = tomorrow.find((r) => r.id !== item.id && r.id !== candidate.id);
    clock = uncertain.scheduledAt.getTime() + 1000;
    state.throwSend = true;
    await processRecord(uncertain.queueId);
    assert.equal(state.requests.length, before + 1);
    clock += 2 * 60 * 60 * 1000;
    await processRecord(uncertain.queueId);
    assert.equal(state.requests.length, before + 1);
    const [held] = await database.select().from(schema.emailPreparedSends).where(eq(schema.emailPreparedSends.id, uncertain.id));
    assert.equal(held.status, 'uncertain');
    print('PASS 전송 응답 불명확·재시작 상황에서 자동 중복 전송 차단');

    // 오후에 처음 올려도 지난 오전 구간을 버리는 대신 남은 시간 안에 하루 할당량 전체를 예약한다.
    clock = realDate.parse('2026-10-14T13:00:00+09:00');
    await database.insert(schema.emailSenderProfiles).values({ id: 3, orgId, name: '오후 시험', fromName: '시험', fromEmail: 'late@example.invalid', dailyLimit: 10 });
    await database.insert(schema.records).values(Array.from({ length: 10 }, (_, i) => ({ ...recordValues[0], id: 1001 + i, data: { email: `late${i}@example.invalid` } })));
    await database.insert(schema.emailSendQueue).values(Array.from({ length: 10 }, (_, i) => ({ id: 1001 + i, recordId: 1001 + i, orgId, partitionId: 1, triggerType: 'on_create' })));
    const { reservePreparedSend } = require('../src/lib/email-prepared-sends.ts');
    const allocations = [];
    for (let i = 0; i < 10; i++) allocations.push(await reservePreparedSend({ queueId: 1001 + i, linkId: 1, orgId, ids: [3], config: null, sourceHash: 'late-fixture' }));
    assert.ok(allocations.every((r) => r.kind === 'reserved' && r.row.scheduledAt.getTime() > clock && r.row.scheduledAt.getTime() < realDate.parse('2026-10-14T18:00:00+09:00')));
    const repeated = await Promise.all([1, 2].map(() => reservePreparedSend({ queueId: 1001, linkId: 1, orgId, ids: [3], config: null, sourceHash: 'late-fixture' })));
    assert.equal(repeated[0].row.id, repeated[1].row.id);
    print('PASS 오후 첫 업로드도 남은 시간에 10건 예약, 같은 작업 재예약·경합에도 동일한 자리 유지');
    const { beginPreparedDelivery, savePreparedContent } = require('../src/lib/email-prepared-sends.ts');
    const payload = { recipientEmail: 'duplicate@example.invalid', subject: '가상 중복 검사', body: '격리 검사', unsubscribeToken: null };
    await Promise.all(allocations.slice(0, 2).map((r) => savePreparedContent(r.row.id, payload)));
    const duplicateStarts = await Promise.all(allocations.slice(0, 2).map((r) => beginPreparedDelivery(r.row.id, {
      orgId, partitionId: 1, recordId: r.row.queueId, recipientEmail: payload.recipientEmail, subject: payload.subject,
      status: 'pending', triggerType: 'ai_auto', senderProfileId: 3,
    }, true)));
    assert.equal(duplicateStarts.filter((r) => r.logId).length, 1);
    assert.equal(duplicateStarts.filter((r) => r.skip === 'duplicate_recipient').length, 1);
    print('PASS 같은 수신자 동시 전송 선점은 한 건만 허용');
    print(JSON.stringify({ result: 'passed', fixtureRecords: 1010, preparedAcrossTwoDays: state.generated, researched: state.researched, simulatedDeliveryRequests: state.requests.length, externalRequests: 0 }));
  } finally {
    Module._load = originalLoad;
    global.Date = realDate;
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    await pg.close();
  }
}

main().catch((error) => { errors(error); process.exitCode = 1; });
