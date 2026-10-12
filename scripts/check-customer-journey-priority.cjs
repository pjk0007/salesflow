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
const { listAssessedLeads } = require('../src/lib/customer-journey-leads.ts');
const { getLeadFollowup, saveLeadFollowup } = require('../src/lib/customer-journey-followup.ts');
const { parseFollowupPatch } = require('../src/lib/customer-journey-followup-rules.ts');
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
  let beforeReminderClaim;
  let afterReminderClaim;
  const calls = [];
  let nextResult = { ok: true };
  global.fetch = async () => { throw new Error('외부 네트워크 차단: 격리 검사'); };
  const conn = async (strings, ...params) => {
    const sql = strings.reduce((t, part, i) => t + part + (i < params.length ? `$${i + 1}` : ''), '');
    // 단일 메모리 DB의 잠금만 대체한다. 후보·집계·재확인·갱신 SQL은 실제 Postgres에서 실행한다.
    if (sql.includes('pg_try_advisory_lock')) return [{ ok: true }];
    if (sql.includes('pg_advisory_unlock')) return [{}];
    if (beforePending && sql.includes('SELECT id, org_id, workspace_id')) { const f = beforePending; beforePending = undefined; await f(); }
    if (beforeReminderClaim && sql.includes('SET last_reminded_at=')) { const f = beforeReminderClaim; beforeReminderClaim = undefined; await f(); }
    const rows = (await pg.query(sql, params)).rows;
    if (afterReminderClaim && sql.includes('SET last_reminded_at=') && rows.length) { const f = afterReminderClaim; afterReminderClaim = undefined; await f(); }
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
    await pg.exec('TRUNCATE journey_lead_followups,customer_journey_alerts,tracker_events,tracker_sessions,tracker_visitors,visitor_record_links,email_click_logs,email_send_logs,records,email_unsubscribes,record_events,tracker_funnels RESTART IDENTITY');
    calls.length = 0; nextResult = { ok: true }; beforePending = undefined; beforeReminderClaim = undefined; afterReminderClaim = undefined;
  };
  try {
    for (const table of [schema.organizations, schema.users, schema.organizationMembers, schema.workspaces, schema.fieldDefinitions, schema.partitions, schema.records,
      schema.emailSenderProfiles, schema.emailSendLogs, schema.emailClickLogs, schema.emailUnsubscribes, schema.trackerSites, schema.trackerSessions,
      schema.trackerVisitors, schema.visitorRecordLinks, schema.trackerEvents, schema.trackerEventAliases, schema.trackerFunnels, schema.recordEvents]) await pg.exec(ddl(table));
    await pg.exec(fs.readFileSync(path.join(root, 'drizzle/0077_customer_journey_alerts.sql'), 'utf8'));
    await pg.exec(fs.readFileSync(path.join(root, 'drizzle/0079_journey_lead_followups.sql'), 'utf8'));
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
    await run(new Date(now.getTime() + 86400_000));
    assert.equal(calls.length, 2); assert.match(calls[1].message.text, /🔴 핵심 리드/);
    assert.match(JSON.stringify(calls[1].message), /최근 30일 비교 고객 20명/);
    console.log('PASS 사업별 최근 30일 20명 이상 비교에서만 상위 5% 판정, 75점의 강한 행동 리드 태그');

    await reset(); await seed(70, { weak: true }); await seed(71);
    await insert('tracker_events', { site_id: 2, visitor_id: 70, session_id: 70, event_type: 'CUSTOM', event_name: 'subscribe_step_1', occurred_at: at(0.5) });
    await insert('tracker_events', { site_id: 2, visitor_id: 70, session_id: 70, event_type: 'SECTION_VIEW', event_name: 'service-pricing', occurred_at: at(1), properties: JSON.stringify({ dwell_ms: 1000 }) });
    await run();
    assert.equal(calls.length, 1); assert.ok(calls[0].message.text.includes('가상 회사 71'));
    const short = (await pg.query('SELECT status,message FROM customer_journey_alerts WHERE record_id=70')).rows[0];
    assert.equal(short.status, 'skipped'); assert.equal(short.message.journeyPriority.rankEligible, false);
    assert.equal(short.message.journeyPriority.score, 0); assert.equal(short.message.journeyPriority.excludedReason, '3초 미만 짧은 방문');
    console.log('PASS 1초 방문에 버튼·영역 이벤트가 있어도 카드·태그·관심도 집계 제외, 정상 방문은 유지');

    await reset(); await seed(72);
    beforePending = async () => {
      await pg.query('UPDATE tracker_sessions SET duration=1,ended_at=$1,page_count=1 WHERE id=72', [at(1)]);
      await pg.query('DELETE FROM tracker_events WHERE session_id=72 AND occurred_at>$1', [at(1)]);
      await insert('tracker_events', { site_id: 2, visitor_id: 72, session_id: 72, event_type: 'CUSTOM', event_name: 'subscribe_step_1', occurred_at: at(0.5) });
    };
    await run(); assert.equal(calls.length, 0);
    const pendingShort = (await pg.query('SELECT status,message FROM customer_journey_alerts WHERE record_id=72')).rows[0];
    assert.equal(pendingShort.status, 'skipped'); assert.equal(pendingShort.message.journeyPriority.rankEligible, false);
    console.log('PASS 전송 대기 중 1초 방문으로 확인되면 전송 직전 재판정에서 카드·태그 중단');

    const tomorrow = new Date(now.getTime() + 86400_000);
    const list = (time = now, tenant = org) => listAssessedLeads(conn, { orgId: tenant, now: time, env });
    const actor = { orgId: org, userId: memberId, name: '가상 담당자' };
    const save = (id, status, revision, time = now, dueAt = null) => saveLeadFollowup(conn, actor, id,
      parseFollowupPatch({ status, revision, dueAt, note: '가상 연락 기록' }), time, env);

    await reset(); await seed(80); await seed(81, { weak: true }); await seed(82, { email: 'ceo@matchesplan.com' });
    await seed(83, { twoCategories: true }); await seed(85, { workspace: 9 }); await run();
    const canonical = await list(); assert.deepEqual(canonical.map((l) => l.recordId).sort(), [80, 83, 85]);
    for (const lead of canonical) {
      const stored = (await pg.query('SELECT message FROM customer_journey_alerts WHERE id=$1', [lead.alertId])).rows[0].message.journeyPriority;
      assert.deepEqual(lead.priority, stored);
    }
    assert.equal((await list(now, otherOrg)).length, 0);
    await addSession(86, 80, 2, 'click-80', new Date(startAt.getTime() + 3600_000));
    await pg.query('DELETE FROM tracker_events WHERE session_id=86 AND event_type<>$1', ['PAGE_VIEW']);
    await pg.query('DELETE FROM tracker_events WHERE session_id=86 AND occurred_at>$1', [at(0, new Date(startAt.getTime() + 3600_000))]);
    await pg.query('UPDATE tracker_sessions SET duration=30,ended_at=$1,page_count=1 WHERE id=86', [at(30, new Date(startAt.getTime() + 3600_000))]);
    const later = new Date(now.getTime() + 3600_000); await run(later);
    assert.ok(!(await list(later)).some((l) => l.recordId === 80));
    console.log('PASS CRM·챗 판정 완전 일치, 내부·짧은 방문·다른 조직 제외, 최신 일반 방문이면 옛 긴급 판정 사용 안 함');

    await reset(); await seed(90, { email: 'shared-email@example.test' }); await seed(91, { email: 'shared-email@example.test' });
    await seed(92, { workspace: 9, email: 'shared-email@example.test' }); await run();
    assert.equal((await list()).length, 2); // 같은 사업의 중복 레코드는 한 명
    const planned = await save(90, 'planned', 0, now, new Date(now.getTime() + 3 * 86400_000).toISOString());
    assert.equal(planned.lead.followup.status, 'planned');
    assert.equal((await getLeadFollowup(conn, org, 91, now, env)).lead.followup.revision, 1);
    assert.equal((await getLeadFollowup(conn, org, 92, now, env)).lead.followup.status, 'new');
    await assert.rejects(save(90, 'contacted', 0), (e) => e.status === 409);
    assert.equal((await getLeadFollowup(conn, org, 90, now, env)).history.length, 1);
    await assert.rejects(getLeadFollowup(conn, otherOrg, 90, now, env), (e) => e.status === 404);
    await save(91, 'contacted', 1);
    await addSession(93, 91, 2, 'click-91', new Date(startAt.getTime() + 2 * 86400_000));
    const twoDays = new Date(now.getTime() + 2 * 86400_000); await run(twoDays);
    const repeated = calls.filter((c) => c.message.text.includes('가상 회사 91')).at(-1);
    assert.equal(repeated.options.mentionUserId, undefined); assert.match(JSON.stringify(repeated.message), /연락 완료/);
    assert.equal((await getLeadFollowup(conn, org, 90, twoDays, env)).lead.followup.status, 'contacted');
    console.log('PASS 중복 CRM 고객 상태 공유·사업별 분리, 수정 충돌 방지·원자적 이력, 연락 완료 뒤 재방문 태그 억제');

    await reset(); await seed(100); await run(); await run(tomorrow); await run(tomorrow);
    assert.equal(calls.length, 2); assert.match(calls[1].message.text, /후속 대응 재알림/);
    assert.equal(calls[1].options.mentionUserId, '110605666755540583322');
    for (let days = 2; days <= 4; days++) await run(new Date(now.getTime() + days * 86400_000));
    assert.equal(calls.length, 4); assert.equal((await pg.query('SELECT reminder_count FROM journey_lead_followups')).rows[0].reminder_count, 3);
    console.log('PASS 미확인 24시간 뒤 재알림, 같은 날 중복 없음, 하루 한 번 최대 3회');

    await reset(); await seed(110); await run(); nextResult = { ok: false, uncertain: true, retryable: true };
    await run(tomorrow); await run(new Date(tomorrow.getTime() + 660_000));
    assert.equal(calls.length, 2); assert.equal((await pg.query('SELECT reminder_result FROM journey_lead_followups')).rows[0].reminder_result, 'uncertain');
    nextResult = { ok: true };
    await addSession(111, 110, 2, 'click-110', new Date(startAt.getTime() + 86400_000 + 3600_000));
    await run(new Date(tomorrow.getTime() + 3600_000));
    assert.equal(calls.at(-1).options.mentionUserId, undefined);
    console.log('PASS 재알림 결과 불명확 시 재전송 없음, 재방문과 재알림의 담당자 태그 24시간 제한 공유');

    await reset(); for (const id of [120, 121, 122, 123]) await seed(id); await run();
    await pg.query('UPDATE tracker_visitors SET email=$1 WHERE id=120', ['employee@gmail.test']);
    await insert('tracker_events', { site_id: 2, visitor_id: 121, session_id: 121, event_type: 'CUSTOM', event_name: 'signup_complete', occurred_at: new Date(now.getTime() + 1000).toISOString() });
    await pg.query('UPDATE tracker_sessions SET duration=1,ended_at=$1 WHERE id=122', [at(1)]);
    await insert('tracker_events', { site_id: 2, visitor_id: 123, session_id: 123, event_type: 'CLICK', event_name: 'faq-open', occurred_at: new Date(tomorrow.getTime() - 30_000).toISOString() });
    await run(tomorrow); assert.equal(calls.length, 4);
    assert.equal((await list(tomorrow)).length, 0);
    console.log('PASS 재알림 직전 내부자·완료·짧은 방문·최근 활동 재확인, CRM에서도 현재 제외');

    await reset(); await seed(130); await run(); await save(130, 'planned', 0, now, new Date(tomorrow.getTime() + 3600_000).toISOString());
    await run(tomorrow); assert.equal(calls.length, 1);
    await run(new Date(tomorrow.getTime() + 3600_000)); assert.equal(calls.length, 2);
    await save(130, 'consulting', 1, new Date(tomorrow.getTime() + 3600_000));
    await insert('tracker_funnels', { org_id: org, site_id: 2, name: '가상 상담 단계', kind: 'marketing', is_default: 1,
      stages: JSON.stringify([{ match: { type: 'record_field', field: 'stage', value: '상담 진행' } }]) });
    await run(new Date(now.getTime() + 2 * 86400_000)); assert.equal(calls.length, 2);
    assert.equal((await list(new Date(now.getTime() + 2 * 86400_000))).length, 1);
    console.log('PASS 연락 예정 기한 전에는 대기, 기한 이후 재알림, 상담 진행이면 중단');

    await reset(); await seed(140); await run();
    beforeReminderClaim = async () => { await save(140, 'contacted', 0, tomorrow); };
    await run(tomorrow); assert.equal(calls.length, 1);
    console.log('PASS 재알림 선점 전에 담당자가 처리하면 수정 버전 확인으로 전송 취소');

    await reset(); await seed(141); await run();
    afterReminderClaim = async () => { await save(141, 'contacted', 0, tomorrow); };
    await run(tomorrow); assert.equal(calls.length, 1);
    assert.equal((await pg.query('SELECT reminder_result FROM journey_lead_followups')).rows[0].reminder_result, 'cancelled');
    console.log('PASS 선점 이후 담당자가 처리한 경우에도 전송 직전 재확인으로 취소');

    await reset(); await seed(150); await run(now, { JOURNEY_ALERT_MODE: 'dry_run' });
    await pg.exec('TRUNCATE journey_lead_followups');
    const migration = fs.readFileSync(path.join(root, 'drizzle/0079_journey_lead_followups.sql'), 'utf8');
    await pg.exec(migration); await pg.exec(migration);
    const backfilled = (await pg.query('SELECT status,revision,first_urgent_at FROM journey_lead_followups')).rows;
    assert.equal(backfilled.length, 1); assert.equal(backfilled[0].status, 'new'); assert.equal(backfilled[0].revision, 0); assert.ok(backfilled[0].first_urgent_at);
    console.log('PASS 기존 최근 판정의 처리 상태 준비, 마이그레이션 재실행 시 중복 생성·덮어쓰기 없음');

    await reset();
    await insert('field_definitions', { workspace_id: 8, key: 'icp', label: 'ICP', field_type: 'text' });
    for (let id = 160; id <= 211; id++) await seed(id);
    await pg.query("UPDATE records SET data=jsonb_set(data,'{icp}',to_jsonb($1::text))", ['핵심']);
    await run(); await run(); assert.equal(calls.length, 52);
    await pg.query('UPDATE tracker_visitors SET email=$1 WHERE id BETWEEN 160 AND 210', ['employee@gmail.test']);
    await run(tomorrow); assert.equal(calls.length, 52);
    await run(new Date(tomorrow.getTime() + 300_000)); assert.equal(calls.length, 53);
    assert.ok(calls.at(-1).message.text.includes('가상 회사 211'));
    console.log('PASS 제외 대상이 50건 이상 쌓여도 다음 회차에서 뒤의 정상 고객 재알림 처리');

    await reset(); await seed(60); const dry = await run(now, { JOURNEY_ALERT_MODE: 'dry_run' });
    assert.equal(dry.mode, 'dry_run'); assert.equal(calls.length, 0);
    assert.equal((await pg.query('SELECT status FROM customer_journey_alerts')).rows[0].status, 'dry_run');
    await run(tomorrow, { JOURNEY_ALERT_MODE: 'dry_run' }); assert.equal(calls.length, 0);
    console.log(JSON.stringify({ result: 'passed', externalRequests: 0, productionOrDevelopmentDbAccess: false, scenarios: 18 }));
  } finally { global.fetch = realFetch; await pg.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
