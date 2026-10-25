import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { openPglite } from "../db/pglite-harness.test-helper";
import {
    clampEventAliasPage,
    eventAliasCountSql,
    eventAliasPageSql,
    parseEventAliasListQuery,
    type EventAliasListQuery,
} from "./event-alias-list";

// UX-204 — 이벤트가 200종을 넘어도 타입·검색·페이지로 모든 이벤트와 등록 별칭에 닿는지 실제 SQL로 확인한다.
const dialect = new PgDialect();
const SITE = 1;

async function open() {
    const pg = await openPglite([]);
    await pg.exec(`
        CREATE TABLE tracker_events (id serial PRIMARY KEY, site_id int NOT NULL, event_type text NOT NULL, event_name text);
        CREATE TABLE tracker_event_aliases (id serial PRIMARY KEY, site_id int NOT NULL, event_type text NOT NULL, event_name text NOT NULL, label text NOT NULL);
    `);
    // CLICK 205종 — 앞의 것일수록 많이 발생
    for (let i = 0; i < 205; i++) {
        const n = 205 - i;
        await pg.query(`INSERT INTO tracker_events (site_id, event_type, event_name) SELECT $1, 'CLICK', $2 FROM generate_series(1, $3)`, [SITE, `btn_${String(i).padStart(3, "0")}`, n]);
    }
    // 저빈도 CLICK 1회 + 등록 별칭
    await pg.query(`INSERT INTO tracker_events (site_id, event_type, event_name) VALUES ($1, 'CLICK', 'rare_cta')`, [SITE]);
    await pg.query(`INSERT INTO tracker_event_aliases (site_id, event_type, event_name, label) VALUES ($1, 'CLICK', 'rare_cta', '드문 신청 버튼')`, [SITE]);
    // 발생 0회 등록 별칭(SECTION_VIEW) — 정렬상 CLICK 뒤에 온다
    await pg.query(`INSERT INTO tracker_event_aliases (site_id, event_type, event_name, label) VALUES ($1, 'SECTION_VIEW', 'hero', '첫 화면')`, [SITE]);
    // 다른 사이트 자료는 섞이지 않는다
    await pg.query(`INSERT INTO tracker_events (site_id, event_type, event_name) VALUES (2, 'CLICK', 'other_site')`);
    await pg.query(`INSERT INTO tracker_event_aliases (site_id, event_type, event_name, label) VALUES (2, 'CUSTOM', 'other_alias', '남의 별칭')`);
    return pg;
}

async function run<T>(pg: Awaited<ReturnType<typeof open>>, q: SQL) {
    const { sql, params } = dialect.sqlToQuery(q);
    return (await pg.query<T>(sql, params)).rows;
}

async function list(pg: Awaited<ReturnType<typeof open>>, raw: Record<string, string>) {
    const requested = parseEventAliasListQuery(new URLSearchParams(raw));
    const [{ total }] = await run<{ total: number }>(pg, eventAliasCountSql(SITE, requested));
    const query: EventAliasListQuery = clampEventAliasPage(requested, total);
    const rows = await run<{ id: number | null; eventType: string; eventName: string; label: string | null; occurrences: number }>(pg, eventAliasPageSql(SITE, query));
    return { total, page: query.page, totalPages: Math.ceil(total / query.pageSize), rows };
}

test("207종(CLICK 206 + 0회 등록 별칭) — 전체 건수와 페이지 수가 맞고 마지막 페이지에 0회 별칭이 있다", async () => {
    const pg = await open();
    try {
        const first = await list(pg, {});
        assert.equal(first.total, 207);
        assert.equal(first.totalPages, 5);
        assert.equal(first.rows.length, 50);
        assert.equal(first.rows[0].eventName, "btn_000");
        const last = await list(pg, { page: "5" });
        assert.equal(last.rows.length, 7);
        assert.deepEqual(last.rows.at(-1), { id: last.rows.at(-1)!.id, eventType: "SECTION_VIEW", eventName: "hero", label: "첫 화면", occurrences: 0 });
        // 페이지를 넘겨 모아도 중복·누락이 없다
        const names = new Set<string>();
        for (let p = 1; p <= 5; p++) for (const r of (await list(pg, { page: String(p) })).rows) names.add(`${r.eventType}:${r.eventName}`);
        assert.equal(names.size, 207);
        assert.ok(!names.has("CLICK:other_site") && !names.has("CUSTOM:other_alias"));
    } finally {
        await pg.close();
    }
});

test("타입 필터는 LIMIT 전에 적용 — 섹션만 보면 0회 등록 별칭이 첫 페이지에 나온다, 이벤트 코드는 0건", async () => {
    const pg = await open();
    try {
        const section = await list(pg, { type: "SECTION_VIEW" });
        assert.equal(section.total, 1);
        assert.equal(section.rows[0].label, "첫 화면");
        const custom = await list(pg, { type: "CUSTOM" });
        assert.equal(custom.total, 0);
        assert.equal(custom.totalPages, 0);
        assert.equal(custom.page, 1);
    } finally {
        await pg.close();
    }
});

test("검색은 이름·라벨 모두 — 저빈도 등록 별칭을 라벨로 찾아 편집할 id를 받는다, %는 글자 그대로", async () => {
    const pg = await open();
    try {
        const byLabel = await list(pg, { q: "드문" });
        assert.equal(byLabel.total, 1);
        assert.equal(byLabel.rows[0].eventName, "rare_cta");
        assert.ok(byLabel.rows[0].id);
        const byName = await list(pg, { q: "RARE" });
        assert.equal(byName.rows[0].occurrences, 1);
        assert.equal((await list(pg, { q: "%" })).total, 0);
    } finally {
        await pg.close();
    }
});

test("마지막을 넘는 page는 마지막 유효 페이지로 당기고 잘못된 값은 기본값", async () => {
    const pg = await open();
    try {
        const over = await list(pg, { page: "99" });
        assert.equal(over.page, 5);
        assert.equal(over.rows.length, 7);
    } finally {
        await pg.close();
    }
    assert.deepEqual(parseEventAliasListQuery(new URLSearchParams({ page: "0", pageSize: "abc", type: "PAGE_VIEW" })), { type: null, q: "", page: 1, pageSize: 50 });
    assert.equal(parseEventAliasListQuery(new URLSearchParams({ pageSize: "1000" })).pageSize, 200);
});
