import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

// 가상 CTE SELECT만 실행: DDL·마이그레이션·실제 DB 연결 없음.
test("UX-283/289: 현재 필드·과거 도달 합집합과 경계 있는 페이지 경로", async (t) => {
    process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/never_connect";
    const { db, queryClient } = await import("@/lib/db");
    const { getStageVisitorIds } = await import("./funnel-analytics");
    const pg = new PGlite();
    const dialect = new PgDialect();
    const fixture = `WITH
      tracker_visitors(id,record_id) AS (VALUES (1,101),(2,102),(3,103),(4,104)),
      visitor_record_links(visitor_id,record_id) AS (VALUES (1,101)),
      tracker_sites(id,org_id) AS (VALUES (10,1)),
      records(id,org_id,data) AS (VALUES
       (101,1,'{"progress":"계약"}'::jsonb),(102,1,'{"progress":"종료"}'::jsonb),
       (103,2,'{"progress":"계약"}'::jsonb),(104,1,'{"progress":"신규"}'::jsonb)),
      record_events(record_id,type,label) AS (VALUES (102,'progress','계약'),(104,'status','계약')),
      tracker_events(visitor_id,site_id,event_type,page_url) AS (VALUES
       (1,10,'PAGE_VIEW','https://example.test/?q=x#anchor'),
       (2,10,'PAGE_VIEW','https://example.test/product?x=1'),
       (3,10,'PAGE_VIEW','https://example.test/product/123#anchor'),
       (4,10,'PAGE_VIEW','https://example.test/products-old'),
       (5,10,'PAGE_VIEW','https://example.test/sale%/child'),
       (6,10,'PAGE_VIEW','https://example.test/sale-other/child'),
       (7,99,'PAGE_VIEW','https://example.test/product'),
       (8,10,'CLICK','https://example.test/product'))`;
    t.mock.method(db, "execute", async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        const body = compiled.sql.trim();
        const text = /^WITH /i.test(body) ? `${fixture}, ${body.slice(5)}` : `${fixture} ${body}`;
        return (await pg.query(text, compiled.params)).rows;
    });
    const ctx = { siteId: 10, meaningfulVisitorIdsSql: sql`(SELECT generate_series(1,8))` };
    try {
        assert.deepEqual([...await getStageVisitorIds(ctx, { type: "record_field", field: "progress", value: "계약" })].sort(), [1,2]);
        assert.deepEqual([...await getStageVisitorIds(ctx, { type: "page_url", pathPrefix: "/" })], [1]);
        assert.deepEqual([...await getStageVisitorIds(ctx, { type: "page_url", pathPrefix: "/product/" })].sort(), [2,3]);
        assert.deepEqual([...await getStageVisitorIds(ctx, { type: "page_url", pathPrefix: "/sale%" })], [5]);
    } finally { await pg.close(); await queryClient.end(); }
});
