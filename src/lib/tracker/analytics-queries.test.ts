import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { idArraySql, idInFilterSql, sessionInFilterSql } from "./sql-filters";
import { summarizeChannelConversions } from "@/components/journey/utils/referrer";
import { classifyInflow, isPaidChannel } from "@/components/journey/utils/referrer";
import { parseInflowDetail } from "@/components/tracker/utils/inflowDetail";

// SQL만 메모리 엔진에서 실행한다. 테이블 생성·마이그레이션·외부 DB 연결 없음.
const fixture = `WITH
 tracker_visitors(id, site_id, record_id, first_seen_at, device_type) AS (VALUES
  (1, 10, 101, '2026-09-01'::timestamptz, 'mobile'),
  (2, 10, 102, '2026-10-25'::timestamptz, 'desktop'),
  (3, 10, 103, '2026-09-01'::timestamptz, 'mobile'),
  (4, 10, 101, '2026-09-01'::timestamptz, 'mobile'),
  (5, 99, 999, '2026-09-01'::timestamptz, 'mobile')),
 tracker_events(visitor_id, site_id, session_id, event_type, occurred_at, page_url) AS (VALUES
  (1,10,11,'PAGE_VIEW','2026-10-25T00:00:00+09:00'::timestamptz,'https://example.test/pricing'),
  (1,10,11,'CLICK','2026-10-25T00:01:00+09:00'::timestamptz,'https://example.test/pricing'),
  (2,10,12,'PAGE_VIEW','2026-10-25T08:59:00+09:00'::timestamptz,'https://example.test/'),
  (3,10,13,'PAGE_VIEW','2026-10-25T09:00:00+09:00'::timestamptz,'https://example.test/internal'),
  (4,10,14,'PAGE_VIEW','2026-10-25T09:00:00+09:00'::timestamptz,'https://example.test/'),
  (5,99,15,'PAGE_VIEW','2026-10-25T09:00:00+09:00'::timestamptz,'https://example.test/')),
 tracker_sessions(id,visitor_id,site_id,started_at,duration) AS (VALUES
  (11,1,10,'2026-10-25T00:00:00+09:00'::timestamptz,60),
  (12,2,10,'2026-10-25T08:59:00+09:00'::timestamptz,120),
  (13,3,10,'2026-10-25T09:00:00+09:00'::timestamptz,30),
  (14,4,10,'2026-10-25T09:00:00+09:00'::timestamptz,180)),
 record_events(record_id,type,label,occurred_at) AS (VALUES
  (101,'signup','가입','2026-10-25T00:00:00+09:00'::timestamptz),
  (101,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (101,'match_stage','구독','2026-10-25T09:00:00+09:00'::timestamptz),
  (102,'signup','가입','2026-10-25T08:59:00+09:00'::timestamptz),
  (103,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz),
  (999,'signup','가입','2026-10-25T09:00:00+09:00'::timestamptz))`;

test("UX-211/201: 활성 KPI와 일별 전환은 재방문·기기·채널·제외 경로에서 같은 방문자 집합", async (t) => {
    // db 객체 생성은 lazy다. execute를 전부 메모리 SELECT로 대체한 뒤 제품 함수를 호출한다.
    process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/never_connect";
    const { db, queryClient } = await import("@/lib/db");
    const { aggregateRange, dailyConversionsSql } = await import("./analytics-queries");
    const pg = new PGlite();
    const dialect = new PgDialect();
    const run = async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        const body = compiled.sql.trim();
        const text = /^WITH /i.test(body) ? `${fixture}, ${body.slice(5)}` : `${fixture} ${body}`;
        return (await pg.query(text, compiled.params)).rows;
    };
    t.mock.method(db, "execute", run);
    try {
        const base = { siteId: 10, fromIso: "2026-10-25T00:00:00+09:00", toIso: "2026-10-25T23:59:59.999+09:00", excludes: ["/internal"], device: null, sessionIds: null };
        for (const zone of ["UTC", "Asia/Seoul", "America/New_York"]) {
            await pg.exec(`SET TIME ZONE '${zone}'`);
            for (const [device, sessionIds, expected] of [
                [null, null, 3], ["mobile", null, 2], [null, [11], 1], ["desktop", [11], 0], [null, [], 0],
            ] as const) {
                const args = { ...base, device, sessionIds: sessionIds ? [...sessionIds] : null };
                const kpi = await aggregateRange(args);
                assert.equal(kpi.visitors, expected, `${zone} / ${device} / ${sessionIds}`);
                assert.equal(kpi.leads, expected);
                assert.equal(kpi.signups, expected);
                const daily = await run(dailyConversionsSql(args, "구독")) as Array<{date: string; signups: number; paid: number}>;
                assert.equal(daily.reduce((sum, row) => sum + row.signups, 0), kpi.signups);
                if (expected) assert.equal(daily[0].date, "2026-10-25");
            }
        }
    } finally {
        await pg.close();
        await queryClient.end();
    }
});

test("UX-286: 70,000 ID도 한 개 바인드로 처리하며 null/빈 목록과 선택 결과를 보존", async () => {
    const dialect = new PgDialect();
    assert.equal(idInFilterSql(null, "id"), null);
    assert.equal(dialect.sqlToQuery(sessionInFilterSql(null, "id")).sql, "");
    const ids = Array.from({ length: 70_000 }, (_, i) => i + 1);
    const compiled = dialect.sqlToQuery(sql`SELECT count(*)::int AS count FROM generate_series(1, 70001) id WHERE ${idInFilterSql(ids, "id")}`);
    assert.equal(compiled.params.length, 1);
    const pg = new PGlite();
    try {
        assert.deepEqual((await pg.query(compiled.sql, compiled.params)).rows, [{ count: 70000 }]);
        const empty = dialect.sqlToQuery(sql`SELECT 1 WHERE ${idInFilterSql([], "id")}`);
        assert.deepEqual((await pg.query(empty.sql, empty.params)).rows, []);
        const small = dialect.sqlToQuery(sql`SELECT unnest(${idArraySql([5, 2])}) AS id`);
        assert.deepEqual((await pg.query(small.sql, small.params)).rows, [{ id: 5 }, { id: 2 }]);
        console.log(`UX-286 measurement: 70000 IDs, previous binds=70000, current binds=${compiled.params.length}, SQL chars=${compiled.sql.length}`);
    } finally { await pg.close(); }
});

test("UX-202: 전환 표도 gclid·메일 우선·소셜을 유입 분포와 같은 규칙으로 분류", () => {
    for (const [referrer, landing] of [
        [null, "https://example.test/?gclid=x"],
        [null, "https://example.test/?sendb_cid=x&fbclid=x"],
        ["email", null], ["https://facebook.com/post", null],
        ["https://instagram.com/post", null],
        [null, "https://example.test/?utm_source=google&utm_medium=cpc"],
    ]) {
        const detail = parseInflowDetail(referrer, landing);
        assert.equal(detail.channel, classifyInflow(referrer, landing));
        assert.equal(detail.isPaid, isPaidChannel(detail.channel));
    }
    const result = summarizeChannelConversions([
        { visitor_id: 1, is_lead: true, referrer: null, landing_page: "https://example.test/?gclid=x" },
        { visitor_id: 2, is_lead: false, referrer: null, landing_page: "https://example.test/?sendb_cid=x&fbclid=x" },
        { visitor_id: 3, is_lead: true, referrer: "email", landing_page: null },
        { visitor_id: 4, is_lead: false, referrer: null, landing_page: "https://example.test/?utm_source=threads&utm_medium=social" },
    ]);
    assert.deepEqual(result.find(r => r.channel === "메일"), { channel: "메일", visitors: 2, leads: 1, leadRate: 50 });
    assert.equal(result.find(r => r.channel === "구글 검색광고")?.visitors, 1);
    assert.equal(result.find(r => r.channel === "Threads")?.visitors, 1);
});
