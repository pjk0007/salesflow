import test from "node:test";
import assert from "node:assert/strict";
import { openPglite } from "../db/pglite-harness.test-helper";
import { kstDateFilter, rangeBounds } from "./date-range";

// UX-213(QA-04)·UX-198 — 일별 SQL 날짜와 날짜 문자열 경계가 DB 세션 시간대와 무관한지
// 실제 PostgreSQL(메모리 PGlite)에서 확인한다. route와 같은 식을 쓴다:
//   일별:  (occurred_at AT TIME ZONE 'Asia/Seoul')::date::text   — overview·방문자 상세
//   경계:  occurred_at >= $from::timestamptz AND occurred_at <= $to::timestamptz — rangeBounds·kstDateFilter

const EVENTS = [
    "2026-10-17T14:59:00Z", // 10-17 23:59 KST
    "2026-10-17T15:00:00Z", // 10-18 00:00 KST
    "2026-10-17T23:59:00Z", // 10-18 08:59 KST
    "2026-10-18T00:00:00Z", // 10-18 09:00 KST
    "2026-10-18T14:59:00Z", // 10-18 23:59 KST
    "2026-10-31T15:30:00Z", // 11-01 00:30 KST (월말 넘김)
];

async function open(zone: string) {
    const pg = await openPglite([]);
    await pg.exec(`CREATE TABLE ev (occurred_at timestamptz NOT NULL)`);
    for (const at of EVENTS) await pg.query(`INSERT INTO ev VALUES ($1::timestamptz)`, [at]);
    await pg.exec(`SET TIME ZONE '${zone}'`);
    return pg;
}

const EXPECTED_DAILY = [
    { date: "2026-10-17", count: 1 },
    { date: "2026-10-18", count: 4 },
    { date: "2026-11-01", count: 1 },
];

for (const zone of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
    test(`일별 날짜는 KST로 묶인다 — 23:59·00:00·08:59·09:00 KST, DB 세션 ${zone}`, async () => {
        const pg = await open(zone);
        try {
            const { rows } = await pg.query<{ date: string; count: number }>(
                `SELECT (occurred_at AT TIME ZONE 'Asia/Seoul')::date::text AS date, COUNT(*)::int AS count
                 FROM ev GROUP BY 1 ORDER BY 1`
            );
            assert.deepEqual(rows, EXPECTED_DAILY);
            const total = rows.reduce((a, b) => a + b.count, 0);
            assert.equal(total, EVENTS.length);
        } finally {
            await pg.close();
        }
    });

    test(`KST 날짜 경계 파라미터는 세션 시간대로 재해석되지 않는다 — DB 세션 ${zone}`, async () => {
        const pg = await open(zone);
        try {
            const { fromIso, toIso } = rangeBounds("2026-10-18", "2026-10-18");
            const ranged = await pg.query<{ n: number }>(
                `SELECT COUNT(*)::int AS n FROM ev WHERE occurred_at >= $1::timestamptz AND occurred_at <= $2::timestamptz`,
                [fromIso, toIso]
            );
            assert.equal(ranged.rows[0].n, 4);
            // 시작일만 지정 (통합 발송 이력 등)
            const dates = kstDateFilter("2026-10-18", null);
            assert.ok(dates.ok && dates.fromIso);
            const fromOnly = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ev WHERE occurred_at >= $1::timestamptz`, [dates.fromIso]);
            assert.equal(fromOnly.rows[0].n, 5);
        } finally {
            await pg.close();
        }
    });
}

test("이전 식(::date)은 UTC 세션에서 KST 새벽을 전날로 묶는다 — 수정 전 재현", async () => {
    const pg = await open("UTC");
    try {
        const { rows } = await pg.query<{ date: string; count: number }>(
            `SELECT occurred_at::date::text AS date, COUNT(*)::int AS count FROM ev GROUP BY 1 ORDER BY 1`
        );
        assert.notDeepEqual(rows, EXPECTED_DAILY);
        // 이전 시작일 처리('YYYY-MM-DD'::timestamptz)는 세션 자정으로 해석돼 KST 00:00~08:59가 빠진다
        const legacy = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ev WHERE occurred_at >= '2026-10-18'::timestamptz`);
        assert.equal(legacy.rows[0].n, 3);
    } finally {
        await pg.close();
    }
});
