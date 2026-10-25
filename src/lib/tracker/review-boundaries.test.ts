import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { isolateEnv, installFakeDb, type Responder, type FakeCall } from "../auth-fake-db.test-helper";

test("UX-281: 실제 여정의 성공·대기·실패·취소·접수 불명 구분과 성공 집계", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { buildRecordJourney } = await import("./journey");
    for (const [status, label] of [
        ["sent", "메일 발송"], ["pending", "메일 발송 대기"],
        ["failed", "메일 발송 실패"], ["rejected", "메일 발송 실패"],
        ["cancelled", "메일 발송 취소"], ["unknown", "메일 결과 미확인"],
        ["uncertain", "메일 결과 미확인"], ["future_status", "메일 결과 미확인"],
    ]) {
        await t.test(status, async (st) => {
            installFakeDb(st, db, call => {
                assert.equal(call.op, "select");
                if (call.table === "records") return [{ id: 1, orgId: "fake", partitionId: 1, workspaceId: 1, data: {} }];
                if (call.table === "email_send_logs") return [{ id: 1, status, subject: "가상", sentAt: new Date("2026-10-25T00:00:00Z") }];
                if (call.table === "partitions") return [{ fieldTypeId: 1 }];
                return [];
            });
            const result = await buildRecordJourney({ orgId: "fake", recordId: 1, merge: false, channelFilter: ["email"] });
            assert.equal(result?.events[0].type, `email_${status}`);
            assert.equal(result?.events[0].label, `${label}: 가상`);
            assert.equal(result?.summary.density.emailSent, status === "sent" ? 1 : 0);
            assert.equal(result?.attribution.path.length, status === "sent" ? 1 : 0);
        });
    }
});

// CTE SELECT만 실행한다. 실제 DB·테이블 생성·마이그레이션·발송 없음.
const fixture = `WITH
 tracker_visitors(id,site_id,record_id,first_seen_at,device_type) AS (VALUES
  (1,10,101,'2026-09-01'::timestamptz,'mobile'),
  (2,10,101,'2026-09-01'::timestamptz,'desktop'),
  (3,10,103,'2026-09-01'::timestamptz,'mobile'),
  (4,10,104,'2026-09-01'::timestamptz,'mobile'),
  (5,10,105,'2026-09-01'::timestamptz,'mobile'),
  (6,10,106,'2026-09-01'::timestamptz,'mobile'),
  (7,99,107,'2026-09-01'::timestamptz,'mobile')),
 tracker_sessions(id,visitor_id,site_id,started_at,duration,referrer,landing_page) AS (VALUES
  (11,1,10,'2026-10-24T23:59:00+09:00'::timestamptz,120,NULL::text,'https://example.test/?gclid=fake'),
  (12,2,10,'2026-10-25T01:00:00+09:00'::timestamptz,60,NULL,'https://example.test/?gclid=fake'),
  (13,3,10,'2026-10-25T01:00:00+09:00'::timestamptz,60,NULL,'https://example.test/?gclid=fake'),
  (14,4,10,'2026-10-25T23:59:00+09:00'::timestamptz,120,NULL,'https://example.test/?gclid=fake'),
  (15,5,10,'2026-10-24T23:59:00+09:00'::timestamptz,120,NULL,'https://example.test/'),
  (16,6,10,'2026-10-24T23:59:00+09:00'::timestamptz,120,'email','https://example.test/'),
  (17,7,99,'2026-10-24T23:59:00+09:00'::timestamptz,120,NULL,'https://example.test/?gclid=fake')),
 tracker_events(visitor_id,site_id,session_id,event_type,occurred_at,page_url) AS (VALUES
  (1,10,11,'PAGE_VIEW','2026-10-25T00:00:30+09:00'::timestamptz,'https://example.test/pricing'),
  (2,10,12,'PAGE_VIEW','2026-10-25T01:00:30+09:00'::timestamptz,'https://example.test/pricing'),
  (3,10,13,'PAGE_VIEW','2026-10-25T01:00:30+09:00'::timestamptz,'https://example.test/internal'),
  (4,10,14,'PAGE_VIEW','2026-10-26T00:00:30+09:00'::timestamptz,'https://example.test/pricing'),
  (5,10,15,'PAGE_VIEW','2026-10-25T00:00:30+09:00'::timestamptz,'https://example.test/pricing'),
  (6,10,16,'PAGE_VIEW','2026-10-25T00:00:30+09:00'::timestamptz,'https://example.test/pricing'),
  (7,99,17,'PAGE_VIEW','2026-10-25T00:00:30+09:00'::timestamptz,'https://example.test/pricing')),
 record_events(record_id,type,label,occurred_at) AS (VALUES
  (101,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (103,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (104,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (105,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (106,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz))`;

test("UX-211/201: 실제 채널 조회 → 활성 KPI·일별 전환의 자정 경계와 기존 시작일 카드", async (t) => {
    isolateEnv(t);
    const { db, queryClient } = await import("../db");
    const { getSessionIdsByChannel } = await import("./session-filter");
    const { aggregateRange, dailyConversionsSql } = await import("./analytics-queries");
    const pg = new PGlite();
    const dialect = new PgDialect();
    const routeFixture = fixture
        .replace("tracker_visitors(", "visitor_data(")
        .replace("tracker_sessions(", "session_data(")
        .replace("tracker_events(", "event_data(") + `,
        tracker_visitors AS (SELECT *, 'anonymous'::text AS visitor_id, NULL::text AS email, 'test'::text AS browser, 'test'::text AS os FROM visitor_data),
        tracker_sessions AS (SELECT *, NULL::text AS exit_page, 1 AS page_count, NULL::text AS utm_content, NULL::text AS utm_source, NULL::text AS utm_medium, NULL::text AS utm_campaign FROM session_data),
        tracker_events AS (SELECT *, '가상 페이지'::text AS page_title FROM event_data)`;
    const query = async (body: string, params: unknown[]) => (await pg.query(
        /^WITH /i.test(body.trim()) ? `${routeFixture}, ${body.trim().slice(5)}` : `${routeFixture} ${body}`, params,
    )).rows;
    installFakeDb(t, db, ((call: FakeCall) => {
        if (call.op === "select") {
            if (call.table === "organization_members") return [{ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
            if (call.table === "tracker_sites") return [{ id: 10, orgId: "fake", excludePaths: ["/internal"], conversionStage: null }];
            assert.equal(call.table, "tracker_sessions");
            return query(`SELECT id, referrer, landing_page AS "landingPage" FROM tracker_sessions WHERE ${call.sql}`, call.params);
        }
        assert.equal(call.op, "execute");
        return query(call.sql, call.params);
    }) as unknown as Responder);
    const base = { siteId: 10, fromIso: "2026-10-25T00:00:00+09:00", toIso: "2026-10-25T23:59:59.999+09:00", excludes: ["/internal"] };
    try {
        for (const [channel, channelMode, device, expectedIds, expectedCount, sessions] of [
            [null, "all", null, null, 4, 1],
            [null, "paid", null, [11, 12], 2, 1],
            ["구글", "all", "mobile", [11], 1, 0],
            [null, "paid", "mobile", [11], 1, 0],
            [null, "organic", "mobile", [15, 16], 2, 0],
            ["직접", "all", "mobile", [15], 1, 0],
            ["메일", "all", "mobile", [16], 1, 0],
            [null, "paid", "desktop", [12], 1, 1],
            ["네이버", "all", null, [], 0, 0],
        ] as const) {
            await t.test(`${channel ?? "전체"}/${channelMode}/${device ?? "전체기기"}`, async () => {
                const channelArgs = { ...base, channel, channelMode };
                const sessionIds = await getSessionIdsByChannel({ ...channelArgs, activity: { excludes: base.excludes, device } });
                assert.deepEqual(sessionIds?.sort((a, b) => a - b) ?? null, expectedIds);
                const startedSessionIds = await getSessionIdsByChannel(channelArgs);
                const args = { ...base, device, sessionIds, startedSessionIds };
                const kpi = await aggregateRange(args);
                assert.equal(kpi.visitors, expectedCount);
                assert.equal(kpi.leads, expectedCount);
                assert.equal(kpi.signups, expectedCount);
                assert.equal(kpi.sessions, sessions, "기존 시작 기간 세션 카드 유지");
                const compiled = dialect.sqlToQuery(dailyConversionsSql(args, null));
                const daily = await query(compiled.sql, compiled.params) as Array<{ signups: number }>;
                assert.equal(daily.reduce((sum, r) => sum + r.signups, 0), expectedCount);
            });
        }
        assert.deepEqual(await getSessionIdsByChannel({ ...base, channel: null, channelMode: "paid" }), [12, 13, 14], "옵션 없는 신규 코호트/기존 소비자 시작일 계약 유지");
        await t.test("실제 overview route도 현재·비교 기간에 활동 옵션을 전달한다", async () => {
            const { generateToken } = await import("../auth");
            const { GET } = await import("../../app/api/tracker/analytics/overview/route");
            const token = generateToken({ userId: "fake-user", orgId: "fake", email: "fixture@example.test", name: "가상", role: "member", tokenVersion: 0, ...{ membershipId: 71 } });
            const response = await GET(new NextRequest("http://fixture.test/api/tracker/analytics/overview?siteId=10&from=2026-10-25&to=2026-10-25&compareFrom=2026-10-25&compareTo=2026-10-25&channelMode=paid&device=mobile", {
                headers: { authorization: `Bearer ${token}` },
            }));
            const body = await response.json();
            assert.equal(response.status, 200, JSON.stringify(body));
            assert.equal(body.data.kpi.visitors.value, 1);
            assert.equal(body.data.kpi.visitors.deltaPct, 0);
            assert.equal(body.data.funnel.visitors, 1);
            assert.equal(body.data.kpi.sessions.value, 0);
            assert.equal(body.data.dailyConversions[0].signups, 1);
            assert.equal(body.data.devices.types[0].count, 1);
        });
    } finally {
        await pg.close();
        await queryClient.end();
    }
});
