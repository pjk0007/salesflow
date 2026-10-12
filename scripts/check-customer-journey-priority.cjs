/* eslint-disable @typescript-eslint/no-require-imports -- 격리된 Postgres 검사 실행기 */
/*
 * 실제 DB·웹훅·환경 파일을 읽지 않는다. 모든 데이터는 가상이고 외부 네트워크는 차단한다.
 * npm install --prefix .testenv/test-runtime --no-save --no-package-lock @electric-sql/pglite@0.5.8
 * node --import tsx scripts/check-customer-journey-priority.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { PGlite } = require(path.join(root, '.testenv/test-runtime/node_modules/@electric-sql/pglite'));
const { PgDialect, getTableConfig } = require('drizzle-orm/pg-core');
const { SQL } = require('drizzle-orm');
const schema = require('../src/lib/db/schema.ts');
const { processCustomerJourneyAlerts } = require('../src/lib/customer-journey-alert.ts');
const dialect = new PgDialect();
const org = '00000000-0000-4000-8000-000000000001';
const otherOrg = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-10-12T05:00:00Z');
const hook = (space) => `https://chat.googleapis.com/v1/spaces/${space}/messages?key=fake&token=fake`;
const env = { JOURNEY_ALERT_MODE: 'live', JOURNEY_ALERT_TEST_SERVER_LIVE: '1', JOURNEY_ALERT_WORKSPACE_IDS: '8,9,10',
  JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE: JSON.stringify({ 8: hook('AAQASH-gyo4'), 9: hook('AAQAbqhHk2A'), 10: hook('unknown') }), NEXT_PUBLIC_BASE_URL: 'http://isolated.test' };
function ddl(table) {
  const config = getTableConfig(table);
  const literal = (v) => typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
  const columns = config.columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${c.notNull ? ' NOT NULL' : ''}${c.default === undefined ? '' : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : literal(c.default)}`}`);
  return `CREATE TABLE "${config.name}" (${columns.join(',')});`;
}
async function main() {
  const pg = new PGlite();
  await pg.waitReady;
  const realFetch = global.fetch;
  let beforePending;
  const calls = [];
  let nextResult = { ok: true };
  global.fetch = async () => { throw new Error('외부 네트워크 차단: 격리 검사'); };
  const conn = async (strings, ...params) => {
    const sql = strings.reduce((t, part, i) => t + part + (i < params.length ? `$${i + 1}` : ''), '');
    // 단일 메모리 DB의 잠금만 대체한다. 후보·집계·재확인·갱신 SQL은 실제 Postgres에서 실행한다.
    if (sql.includes('pg_try_advisory_lock')) return [{ ok: true }];
    if (sql.includes('pg_advisory_unlock')) return [{}];
    if (beforePending && sql.includes('SELECT id, org_id, workspace_id')) { const f = beforePending; beforePending = undefined; await f(); }
    const rows = (await pg.query(sql, params)).rows;
    // 운영 postgres-js의 jsonb 문자열 경로도 재현한다.
    for (const r of rows) if (r.data && typeof r.data === 'object') r.data = JSON.stringify(r.data);
    return rows;
  };
  conn.release = () => {};
  const run = (time = now, overrides = {}) => processCustomerJourneyAlerts({ client: { reserve: async () => conn }, env: { ...env, ...overrides }, now: time,
    post: async (url, message, _fetch, options) => { calls.push({ url, message, options }); return nextResult; } });
  const insert = async (table, data) => {
    const keys = Object.keys(data);
    await pg.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(data));
  };
  const startAt = new Date(now.getTime() - 1000_000);
  const at = (s, start = startAt) => new Date(start.getTime() + s * 1000).toISOString();
  const addSession = async (id, visitorId, siteId, clickId, start = startAt, weak = false, twoCategories = false) => {
    await insert('tracker_sessions', { id, visitor_id: visitorId, site_id: siteId, session_key: `session-${id}`, started_at: start.toISOString(), ended_at: at(weak ? 1 : 195, start), duration: weak ? 1 : 195, page_count: weak ? 1 : 3, click_id: clickId });
    const events = weak ? [['PAGE_VIEW', null, '/', 0, null]] : [
      ['PAGE_VIEW', null, '/', 0, null], ['SECTION_VIEW', 'trust-cases', '/', 30, { dwell_ms: 20_000 }],
      ['PAGE_VIEW', null, '/pricing', 45, null], ...(!twoCategories ? [['SECTION_VIEW', 'faq', '/pricing', 110, { dwell_ms: 20_000 }]] : []),
      ['PAGE_VIEW', null, '/signup', 125, null], ['CUSTOM', 'subscribe_step_1', '/signup', 130, null],
    ];
    for (const [type, name, page, sec, props] of events) await insert('tracker_events', { session_id: id, visitor_id: visitorId, site_id: siteId,
      event_type: type, event_name: name, page_url: `https://fixture.test${page}`, occurred_at: at(sec, start), properties: props && JSON.stringify(props) });
  };
  const seed = async (id, opts = {}) => {
    const ws = opts.workspace ?? 8, site = ws === 8 ? 2 : ws === 9 ? 3 : 4, tenant = ws === 10 ? otherOrg : org;
    const email = opts.email ?? `person-${id}@example.test`, visitor = opts.visitor ?? id;
    await insert('records', { id, org_id: tenant, workspace_id: ws, partition_id: ws - 7, data: JSON.stringify({ email, company: `가상 회사 ${id}`, stage: opts.stage ?? '' }) });
    await insert('email_send_logs', { id, org_id: tenant, record_id: id, recipient_email: email, status: 'sent', sent_at: at(-600), subject: '격리 테스트' });
    await insert('email_click_logs', { org_id: tenant, send_log_id: id, click_id: `click-${id}`, clicked_at: at(-4), url: 'https://fixture.test' });
    await pg.query('INSERT INTO tracker_visitors (id,org_id,site_id,visitor_id,email) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [visitor, tenant, site, `visitor-${visitor}`, opts.identifiedEmail ?? null]);
    await addSession(id, visitor, site, `click-${id}`, startAt, opts.weak, opts.twoCategories);
  };
  const reset = async () => {
    await pg.exec('TRUNCATE customer_journey_alerts,tracker_events,tracker_sessions,tracker_visitors,visitor_record_links,email_click_logs,email_send_logs,records,email_unsubscribes,record_events,tracker_funnels RESTART IDENTITY');
    calls.length = 0; nextResult = { ok: true }; beforePending = undefined;
  };
  try {
    for (const table of [schema.organizations, schema.users, schema.organizationMembers, schema.workspaces, schema.fieldDefinitions, schema.partitions, schema.records,
      schema.emailSenderProfiles, schema.emailSendLogs, schema.emailClickLogs, schema.emailUnsubscribes, schema.trackerSites, schema.trackerSessions,
      schema.trackerVisitors, schema.visitorRecordLinks, schema.trackerEvents, schema.trackerEventAliases, schema.trackerFunnels, schema.recordEvents]) await pg.exec(ddl(table));
    await pg.exec(fs.readFileSync(path.join(root, 'drizzle/0077_customer_journey_alerts.sql'), 'utf8'));
    await insert('organizations', { id: org, name: '가상 조직', slug: 'fixture' });
    await insert('organizations', { id: otherOrg, name: '가상 다른 조직', slug: 'other' });
    await insert('users', { org_id: org, name: '가상 내부자', email: 'employee@gmail.test', password: 'fixture' });
    const memberId = '00000000-0000-4000-8000-000000000003';
    await insert('users', { id: memberId, org_id: otherOrg, name: '다중 조직 내부자', email: 'multi@gmail.test', password: 'fixture' });
    await insert('organization_members', { organization_id: org, user_id: memberId, role: 'member' });
    await insert('users', { org_id: otherOrg, name: '다른 조직 구성원', email: 'other@gmail.test', password: 'fixture' });
    for (const id of [8, 9, 10]) {
      const tenant = id === 10 ? otherOrg : org;
      await insert('workspaces', { id, org_id: tenant, name: `가상 사업 ${id}` });
      await insert('partitions', { id: id - 7, workspace_id: id, name: '가상 명단' });
      await insert('tracker_sites', { id: id - 6, org_id: tenant, workspace_id: id, name: '가상 사이트', api_key: `fixture-${id}`, domains: JSON.stringify([`fixture-${id}.test`]) });
      for (const [key, type] of [['email', 'email'], ['company', 'text']]) await insert('field_definitions', { workspace_id: id, key, label: key, field_type: type });
    }
    await seed(1); await seed(2, { workspace: 9 }); await seed(3, { email: 'coo@matchesplan.com' });
    await seed(4, { email: 'employee@gmail.test' }); await seed(5); await seed(6, { visitor: 5 });
    await seed(7, { stage: '구독중' }); await seed(8, { identifiedEmail: 'ceo@matchesplan.com' });
    await seed(9); await seed(10, { weak: true }); await seed(11); await seed(12, { workspace: 10 });
    await seed(13, { email: 'other@gmail.test' }); await seed(14, { email: 'multi@gmail.test' }); await seed(15);
    await pg.query('UPDATE records SET org_id=$1 WHERE id=15', [otherOrg]);
    await insert('tracker_funnels', { org_id: org, site_id: 2, name: '가상 전환', kind: 'marketing', is_default: 1,
      stages: JSON.stringify([{ match: { type: 'record_field', field: 'stage', value: '구독중' } }]) });
    for (const id of [91, 92, 93]) await insert('tracker_sessions', { id, visitor_id: 9, site_id: 2, session_key: `prior-${id}`, started_at: at(-10_000 - id), ended_at: at(-9999 - id), duration: 1, page_count: 1 });
    await insert('email_unsubscribes', { org_id: org, workspace_id: 8, record_id: 11, email: 'person-11@example.test' });
    const result = await run();
    assert.equal(result.failed, 0); assert.equal(calls.length, 5);
    assert.deepEqual(calls.filter((c) => c.options.mentionUserId).map((c) => c.options.mentionUserId).sort(), ['101302053528103792273', '110605666755540583322', '110605666755540583322']);
    assert.ok(calls.some((c) => c.message.text.includes('완료')));
    assert.equal(calls.find((c) => c.url.includes('/unknown/')).options.mentionUserId, undefined);
    const skipped = (await pg.query("SELECT message FROM customer_journey_alerts WHERE status = 'skipped'")).rows;
    assert.equal(skipped.length, 9); assert.ok(skipped.every((r) => r.message.journeyPriority.rankEligible === false));
    assert.equal((await pg.query('SELECT id FROM customer_journey_alerts WHERE record_id=15')).rows.length, 0);
    console.log('PASS 실제 SQL: 내부 도메인·개인 직원 계정·identify 내부자·공유 브라우저·기존 방문·스캐너·거부 제외, 완료 고객 분리, 두 사업 담당자 라우팅');

    await reset(); await seed(20); await run();
    await addSession(21, 20, 2, 'click-20', new Date(startAt.getTime() + 3600_000));
    await run(new Date(now.getTime() + 3600_000));
    assert.equal(calls.length, 2); assert.ok(calls[0].options.mentionUserId); assert.equal(calls[1].options.mentionUserId, undefined);
    assert.match(JSON.stringify(calls[1].message), /재태그 생략/);
    console.log('PASS 같은 고객 재방문: 카드는 이어 보내고 담당자 재태그는 24시간 제한');

    await reset(); await seed(30); nextResult = { ok: false, status: null, error: '가상 응답 불명확', retryable: true, uncertain: true };
    await run(); await run(new Date(now.getTime() + 1200_000));
    assert.equal(calls.length, 1);
    assert.equal((await pg.query('SELECT status FROM customer_journey_alerts')).rows[0].status, 'uncertain');
    console.log('PASS 전송 응답 불명확: 자동 재전송·재태그 없음');

    await reset(); await seed(40); await seed(41); await seed(42);
    beforePending = async () => {
      await insert('tracker_events', { site_id: 2, visitor_id: 40, session_id: 40, event_type: 'CUSTOM', event_name: 'signup_complete', occurred_at: new Date(now.getTime() - 60_000).toISOString() });
      await pg.query('UPDATE tracker_visitors SET email=$1 WHERE id=41', ['employee@gmail.test']);
      await insert('tracker_events', { site_id: 2, visitor_id: 42, session_id: 42, event_type: 'CLICK', event_name: 'faq-open', occurred_at: new Date(now.getTime() - 30_000).toISOString() });
    };
    await run();
    assert.equal(calls.length, 0); // 완료 고객도 최근 활동 중이면 우선 기다린다.
    await run(new Date(now.getTime() + 660_000));
    assert.equal(calls.filter((c) => c.message.text.includes('가상 회사 40')).length, 1);
    assert.equal(calls.find((c) => c.message.text.includes('가상 회사 40')).options.mentionUserId, undefined);
    assert.match(calls.find((c) => c.message.text.includes('가상 회사 40')).message.text, /완료/);
    assert.ok(!calls.some((c) => c.message.text.includes('가상 회사 41')));
    console.log('PASS 대기 중 완료·내부자 식별·추가 활동 재확인, 오래된 긴급 태그 방지');

    await reset(); await seed(50, { twoCategories: true });
    const { journeyCustomerKey } = require('../src/lib/customer-journey-priority.ts');
    for (let i = 0; i < 19; i++) await insert('customer_journey_alerts', { org_id: org, workspace_id: 8, record_id: 1000 + i, session_id: 1000 + i,
      last_activity_at: at(-100), stage: '둘러봄', created_at: at(-100), status: 'dry_run',
      message: JSON.stringify({ journeyPriority: { version: 1, rankEligible: true, customerKey: journeyCustomerKey(`cohort-${i}@example.test`), score: i } }) });
    await run(); assert.equal(calls.length, 1); assert.ok(calls[0].options.mentionUserId);
    assert.equal(calls[0].message.journeyPriority.cohortSize, 20); assert.equal(calls[0].message.journeyPriority.score, 75);
    console.log('PASS 사업별 최근 30일 20명 이상 비교에서만 상위 5% 판정, 75점의 강한 행동 리드 태그');

    await reset(); await seed(60); const dry = await run(now, { JOURNEY_ALERT_MODE: 'dry_run' });
    assert.equal(dry.mode, 'dry_run'); assert.equal(calls.length, 0);
    assert.equal((await pg.query('SELECT status FROM customer_journey_alerts')).rows[0].status, 'dry_run');
    console.log(JSON.stringify({ result: 'passed', externalRequests: 0, productionOrDevelopmentDbAccess: false, scenarios: 6 }));
  } finally { global.fetch = realFetch; await pg.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
