import test from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";

// 실제 DB에 접속하지 않는다 — 메모리 PGlite에 필요한 표 모양만 만들어 방문자 상세 조회 조각을 검증한다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

async function setup() {
    const { openPglite } = await import("../db/pglite-harness.test-helper");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const mod = await import("./visitor-detail");
    const dialect = new PgDialect();
    const pg = await openPglite([]);
    await pg.exec(`
        CREATE TABLE tracker_events (id integer PRIMARY KEY, site_id int NOT NULL, session_id int NOT NULL, visitor_id int NOT NULL,
            event_type text NOT NULL, event_name text, page_url text, page_title text, properties jsonb, revenue numeric(14,2),
            occurred_at timestamptz NOT NULL);
        CREATE TABLE tracker_sessions (id integer PRIMARY KEY, visitor_id int NOT NULL, duration int);
    `);
    const exec = {
        execute: async (q: SQL) => {
            const { sql, params } = dialect.sqlToQuery(q);
            return (await pg.query(sql, params)).rows;
        },
    };
    return { pg, exec, ...mod };
}

/** 세션 10(최신, 1001건)과 세션 9(이전, 5건). 세션 10의 마지막 4건은 같은 시각(id로만 구분). */
async function seedEvents(pg: PGlite) {
    await pg.exec(`
        INSERT INTO tracker_events (id, site_id, session_id, visitor_id, event_type, event_name, occurred_at)
        SELECT g, 1, 10, 1, CASE WHEN g % 2 = 0 THEN 'CLICK' ELSE 'PAGE_VIEW' END, 'e' || g,
               '2026-10-20T00:00:00Z'::timestamptz + make_interval(secs => LEAST(g, 998))
        FROM generate_series(1, 1001) g;
        INSERT INTO tracker_events (id, site_id, session_id, visitor_id, event_type, event_name, occurred_at)
        SELECT 5000 + g, 1, 9, 2, 'PAGE_VIEW', NULL, '2026-10-19T00:00:00Z'::timestamptz + make_interval(secs => g)
        FROM generate_series(1, 5) g;
    `);
}

test("UX-207 세션마다 최신 이벤트를 시간순으로 보내고 세션별 전체 수를 준다 — 1001건 세션도 최신 행동이 빠지지 않는다", async () => {
    const { pg, exec, loadLatestSessionEvents, SESSION_EVENT_LIMIT } = await setup();
    try {
        await seedEvents(pg);
        const { events, sessionTotals } = await loadLatestSessionEvents([10, 9], SESSION_EVENT_LIMIT, exec);
        assert.deepEqual(sessionTotals, { 10: 1001, 9: 5 });
        const s10 = events.filter((e) => e.sessionId === 10).map((e) => e.id);
        assert.equal(s10.length, SESSION_EVENT_LIMIT);
        assert.equal(s10.at(-1), 1001, "가장 최근 행동이 포함된다");
        assert.equal(s10[0], 1001 - SESSION_EVENT_LIMIT + 1);
        // 같은 시각(998초)은 id로 보조 정렬
        assert.deepEqual(s10.slice(-4), [998, 999, 1000, 1001]);
        assert.deepEqual(events.filter((e) => e.sessionId === 9).map((e) => e.id), [5001, 5002, 5003, 5004, 5005]);
        assert.ok("occurredAt" in events[0] && "sessionId" in events[0] && "eventName" in events[0], "화면 TrackerEvent와 같은 열 이름");
        // 999·1000·1001건 경계: 상한이 세션 전체보다 크거나 같으면 전부 보낸다
        for (const perSession of [999, 1000, 1001, 1002]) {
            const r = await loadLatestSessionEvents([10], perSession, exec);
            assert.equal(r.events.length, Math.min(perSession, 1001));
            assert.equal(r.events.at(-1)?.id, 1001);
        }
        assert.deepEqual(await loadLatestSessionEvents([], SESSION_EVENT_LIMIT, exec), { events: [], sessionTotals: {} });
    } finally {
        await pg.close();
    }
});

test("UX-207 이전 행동 이어 받기 — 커서로 끝까지 모으면 중복·누락이 없고, 묶음 밖 방문자 세션은 읽지 않는다", async () => {
    const { pg, exec, loadLatestSessionEvents, loadOlderSessionEvents } = await setup();
    try {
        await seedEvents(pg);
        const first = await loadLatestSessionEvents([10], 200, exec);
        const seen = first.events.map((e) => e.id);
        let hasMore = true;
        let pages = 0;
        while (hasMore) {
            const page = await loadOlderSessionEvents({ sessionId: 10, visitorIds: [1], beforeId: seen[0], limit: 200 }, exec);
            assert.ok(page.events.every((e, i, arr) => i === 0 || arr[i - 1].id < e.id), "시간순");
            seen.unshift(...page.events.map((e) => e.id));
            hasMore = page.hasMore;
            pages++;
        }
        assert.equal(pages, 5);
        assert.equal(seen.length, 1001);
        assert.equal(new Set(seen).size, 1001);
        assert.deepEqual(seen.slice(0, 3), [1, 2, 3]);
        // 접근 확인된 방문자 묶음 밖 세션 → 빈 결과
        assert.deepEqual(await loadOlderSessionEvents({ sessionId: 10, visitorIds: [2], beforeId: 900, limit: 50 }, exec), { events: [], hasMore: false });
        // 다른 세션의 이벤트 id를 커서로 주면 아무것도 읽지 않는다
        assert.equal((await loadOlderSessionEvents({ sessionId: 10, visitorIds: [1], beforeId: 5003, limit: 50 }, exec)).events.length, 0);
    } finally {
        await pg.close();
    }
});

test("UX-207 같은 밀리초 안의 이벤트도 커서에서 건너뛰지 않는다 (커서 시각은 DB에서 다시 읽음)", async () => {
    const { pg, exec, loadOlderSessionEvents } = await setup();
    try {
        await pg.exec(`
            INSERT INTO tracker_events (id, site_id, session_id, visitor_id, event_type, occurred_at) VALUES
            (1, 1, 7, 1, 'CLICK', '2026-10-20T00:00:00.123100Z'),
            (2, 1, 7, 1, 'CLICK', '2026-10-20T00:00:00.123400Z'),
            (3, 1, 7, 1, 'CLICK', '2026-10-20T00:00:00.123200Z');
        `);
        const page = await loadOlderSessionEvents({ sessionId: 7, visitorIds: [1], beforeId: 2, limit: 10 }, exec);
        assert.deepEqual(page.events.map((e) => e.id), [1, 3]);
    } finally {
        await pg.close();
    }
});

test("UX-208 총 체류시간은 묶음 전체 세션 합 — 0·1·30·31회, 여러 기기", async () => {
    const { pg, exec, loadTotalDuration } = await setup();
    try {
        assert.equal(await loadTotalDuration([1], exec), 0);
        await pg.exec(`INSERT INTO tracker_sessions (id, visitor_id, duration) VALUES (1, 1, 60)`);
        assert.equal(await loadTotalDuration([1], exec), 60);
        await pg.exec(`INSERT INTO tracker_sessions (id, visitor_id, duration) SELECT g, 1, 10 FROM generate_series(2, 30) g`);
        assert.equal(await loadTotalDuration([1], exec), 60 + 29 * 10);
        await pg.exec(`INSERT INTO tracker_sessions (id, visitor_id, duration) VALUES (31, 1, 100), (32, 1, NULL), (40, 2, 7), (50, 3, 1000)`);
        assert.equal(await loadTotalDuration([1], exec), 60 + 29 * 10 + 100, "31회째 이후 세션도 합산, NULL은 0");
        assert.equal(await loadTotalDuration([1, 2], exec), 60 + 29 * 10 + 100 + 7, "같은 record의 다른 기기 포함");
        assert.equal(await loadTotalDuration([], exec), 0);
    } finally {
        await pg.close();
    }
});

test("UX-209 빈·공백 별칭은 라벨이 없는 것으로 보고 원래 이름을 남긴다", async () => {
    const { labelVisitorEngagement } = await setup();
    const sections = [
        { name: "hero", views: 1 }, { name: "price", views: 2 }, { name: "faq", views: 3 },
        { name: "cta", views: 4 }, { name: null, views: 5 },
    ];
    const clicks = [{ name: "apply", count: 1 }, { name: "call", count: 2 }];
    const r = labelVisitorEngagement(sections, clicks, [
        { eventType: "SECTION_VIEW", eventName: "hero", label: "" },
        { eventType: "SECTION_VIEW", eventName: "price", label: "   " },
        { eventType: "SECTION_VIEW", eventName: "faq", label: " 자주 묻는 질문 " },
        { eventType: "CLICK", eventName: "apply", label: "상담 신청" },
        { eventType: "CLICK", eventName: "call", label: null },
    ]);
    assert.deepEqual(r.sections.map((s) => [s.name, s.label]), [["hero", null], ["price", null], ["faq", "자주 묻는 질문"], ["cta", null]]);
    assert.deepEqual(r.clicks.map((c) => [c.name, c.label]), [["apply", "상담 신청"], ["call", null]]);
    assert.deepEqual(r.aliases, { "SECTION_VIEW:faq": "자주 묻는 질문", "CLICK:apply": "상담 신청" });
});
