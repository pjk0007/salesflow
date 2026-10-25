import test from "node:test";
import assert from "node:assert/strict";
import { and, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { openPglite } from "./db/pglite-harness.test-helper";
import { buildRecordConditions, recordDateTimeSql, type RecordFilter } from "./record-filters";

// UX-061 — 날짜·시간 속성 필터(목록·조건 삭제 공용 빌더)를 실제 PostgreSQL 식으로 검증한다.
// datetime 값은 UTC ISO로 저장되고, 비교는 KST 날짜 기준이어야 하며 DB 세션 시간대와 무관해야 한다.

const dialect = new PgDialect();

const ROWS: [number, number, Record<string, string>][] = [
    [1, 1, { dt: "2026-10-17T15:30:00.000Z" }], // 10-18 00:30 KST
    [2, 1, { dt: "2026-10-17T23:59:00.000Z" }], // 10-18 08:59 KST
    [3, 1, { dt: "2026-10-18T00:00:00.000Z" }], // 10-18 09:00 KST
    [4, 1, { dt: "2026-10-18T14:59:00.000Z" }], // 10-18 23:59 KST
    [5, 1, { dt: "2026-10-17T14:59:00.000Z" }], // 10-17 23:59 KST
    [6, 1, { dt: "2026-10-18T15:00:00.000Z" }], // 10-19 00:00 KST
    [7, 1, { d: "2026-10-18" }], // date 속성
    [8, 1, { dt: "", d: "" }], // 빈 값
    [9, 1, { dt: "미정", d: "미정" }], // 형식 밖 값 — 쿼리 전체가 실패하면 안 된다
    [10, 2, { dt: "2026-10-18T00:00:00.000Z", d: "2026-10-18" }], // 다른 파티션
];

async function open() {
    const pg = await openPglite([]);
    await pg.exec(`CREATE TABLE "records" ("id" integer PRIMARY KEY, "partition_id" integer NOT NULL, "integrated_code" text, "org_id" text, "data" jsonb NOT NULL)`);
    for (const [id, partitionId, data] of ROWS) {
        await pg.query(`INSERT INTO "records" ("id","partition_id","data") VALUES ($1,$2,$3)`, [id, partitionId, JSON.stringify(data)]);
    }
    return pg;
}

test("UX-060·062 잘못된 조건으로 조건 삭제 범위가 넓어지지 않고 숫자·체크박스 혼합 값도 조회된다", async () => {
    const pg = await open();
    try {
        const malformed: unknown[] = [
            { field: "d", operator: "unknown", value: "x" },
            { field: "d", operator: "contains", value: null },
            { field: "d", operator: "between", value: "2026-10-18" },
            ...[["equals"], ["is_empty"], ["gt"], {}, null, 1, true].map(operator => ({ field: "d", operator, value: 1 })),
            { field: "d", operator: "between", value: "2026-10-18", valueTo: ["2026-10-18"] },
            null, [], {},
        ];
        for (const filter of malformed) {
            const q = whereOf([filter] as RecordFilter[]);
            assert.equal((await pg.query(`DELETE FROM records WHERE ${q.sql} RETURNING id`, q.params)).rows.length, 0);
        }
        // 명시적으로 필터를 생략한 공용 빌더는 기존처럼 파티션의 전체 행을 반환한다.
        const all = whereOf([]);
        assert.equal((await pg.query(`SELECT id FROM records WHERE ${all.sql}`, all.params)).rows.length, 9);
        const values = [{ n: "3", b: "true" }, { n: "bad", b: "false" }, { n: "", b: "invalid" }, { n: "2.5", b: 1 }, { n: null, b: null }];
        for (let i = 0; i < values.length; i++) await pg.query("UPDATE records SET data = $2::jsonb WHERE id = $1", [i + 1, JSON.stringify(values[i])]);
        for (const [filter, ids] of [[{ field: "n", operator: "gt", value: 2 }, [1, 4]], [{ field: "b", operator: "is_true", value: null }, [1, 4]]] as const) {
            const q = whereOf([filter]);
            assert.deepEqual((await pg.query<{ id: number }>(`SELECT id FROM records WHERE ${q.sql} ORDER BY id`, q.params)).rows.map((r) => r.id), ids);
        }
    } finally { await pg.close(); }
});

test("UX-063 검색은 통합코드·표시값만 찾고 key·숨은 조사·와일드카드를 검색어로 확장하지 않는다", async () => {
    const pg = await open();
    try {
        await pg.query("UPDATE records SET integrated_code = 'SALES-0012', data = $1::jsonb WHERE id = 1", [JSON.stringify({ companyName: "회사100%", _research: "비공개조사" })]);
        for (const [search, ids] of [["SALES-0012", [1]], ["회사", [1]], ["%", [1]], ["companyName", []], ["비공개조사", []], ["_", []]] as const) {
            const q = dialect.sqlToQuery(and(...buildRecordConditions(1, { search }))!);
            assert.deepEqual((await pg.query<{ id: number }>(`SELECT id FROM records WHERE ${q.sql} ORDER BY id`, q.params)).rows.map((r) => r.id), ids);
        }
    } finally { await pg.close(); }
});

function whereOf(filters: RecordFilter[]) {
    return dialect.sqlToQuery(and(...buildRecordConditions(1, { filters }))!);
}

const CASES: [string, RecordFilter, number[]][] = [
    ["datetime 같음", { field: "dt", operator: "equals", value: "2026-10-18" }, [1, 2, 3, 4]],
    ["datetime 이전", { field: "dt", operator: "before", value: "2026-10-18" }, [5]],
    ["datetime 이후", { field: "dt", operator: "after", value: "2026-10-18" }, [6]],
    ["datetime 사이(하루)", { field: "dt", operator: "between", value: "2026-10-18", valueTo: "2026-10-18" }, [1, 2, 3, 4]],
    ["datetime 사이(이틀)", { field: "dt", operator: "between", value: "2026-10-17", valueTo: "2026-10-18" }, [1, 2, 3, 4, 5]],
    ["date 같음", { field: "d", operator: "equals", value: "2026-10-18" }, [7]],
    ["date 사이", { field: "d", operator: "between", value: "2026-10-18", valueTo: "2026-10-18" }, [7]],
    ["date 이전", { field: "d", operator: "before", value: "2026-10-19" }, [7]],
    ["텍스트 같음은 문자열 비교 그대로", { field: "dt", operator: "equals", value: "미정" }, [9]],
];

for (const zone of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
    test(`날짜·시간 필터는 KST 00:30·08:59·09:00·23:59 경계를 그날로 본다 — DB 세션 ${zone}`, async () => {
        const pg = await open();
        try {
            await pg.exec(`SET TIME ZONE '${zone}'`);
            for (const [name, filter, expected] of CASES) {
                const q = whereOf([filter]);
                const { rows } = await pg.query<{ id: number }>(`SELECT id FROM "records" WHERE ${q.sql} ORDER BY id`, q.params);
                assert.deepEqual(rows.map((r) => r.id), expected, name);
            }
        } finally {
            await pg.close();
        }
    });

    test(`조건 삭제는 목록과 같은 건수를 지운다 — DB 세션 ${zone}`, async () => {
        const pg = await open();
        try {
            await pg.exec(`SET TIME ZONE '${zone}'`);
            const q = whereOf([{ field: "dt", operator: "between", value: "2026-10-18", valueTo: "2026-10-18" }]);
            const listed = await pg.query<{ id: number }>(`SELECT id FROM "records" WHERE ${q.sql} ORDER BY id`, q.params);
            const deleted = await pg.query<{ id: number }>(`DELETE FROM "records" WHERE ${q.sql} RETURNING id`, q.params);
            assert.equal(deleted.rows.length, listed.rows.length);
            assert.deepEqual(deleted.rows.map((r) => r.id).sort((a, b) => a - b), [1, 2, 3, 4]);
            // 경계 밖(10-17 23:59, 10-19 00:00)과 다른 파티션은 남는다
            const left = await pg.query<{ id: number }>(`SELECT id FROM "records" ORDER BY id`);
            assert.deepEqual(left.rows.map((r) => r.id), [5, 6, 7, 8, 9, 10]);
        } finally {
            await pg.close();
        }
    });
}


test("UX-060 달력상 무효 날짜와 잘못된 시각이 있어도 필터가 중단되지 않는다", async () => {
    const pg = await open();
    try {
        const invalid = ["2026-02-31", "2026-13-01", "2026-00-01", "0000-01-01", "2026-02-29", "1900-02-29", "2026-01-00", "2026-01-01T25:00:00Z", "2026-01-01T12:65:00Z", "2026-01-01T12:00:70Z", "2026-01-01T12:00:00+99:00", "2026-01-01Tbad"];
        for (const [i, dt] of invalid.entries()) await pg.query('INSERT INTO records (id, partition_id, data) VALUES ($1,1,$2)', [100+i, JSON.stringify({ dt })]);
        await pg.query('INSERT INTO records (id, partition_id, data) VALUES (200,1,$1)', [JSON.stringify({ dt: "2000-02-29T15:00:00Z" })]);
        const q = whereOf([{ field: "dt", operator: "between", value: "1999-01-01", valueTo: "2026-12-31" }]);
        const result = await pg.query<{ id: number }>(`SELECT id FROM records WHERE ${q.sql} ORDER BY id`, q.params);
        assert.deepEqual(result.rows.map((r) => r.id), [1,2,3,4,5,6,200]);
        const sort = dialect.sqlToQuery(sql`SELECT id, ${recordDateTimeSql("dt")} AS value FROM records ORDER BY ${recordDateTimeSql("dt")}, id`);
        const sorted = await pg.query<{ id: number; value: unknown }>(sort.sql, sort.params);
        assert.equal(sorted.rows[0].id, 200);
        assert.ok(sorted.rows.filter((r) => r.id >= 100 && r.id < 200).every((r) => r.value === null));
    } finally { await pg.close(); }
});


test("UX-042 과거 잘못 연결된 레코드는 파티션이 같아도 다른 조직 목록에서 제외한다", async () => {
    const pg = await open();
    try {
        await pg.exec("UPDATE records SET org_id = CASE WHEN id = 1 THEN 'own' ELSE 'other' END");
        const where = dialect.sqlToQuery(and(...buildRecordConditions(1, { orgId: "own" }))!);
        assert.deepEqual((await pg.query<{ id: number }>(`SELECT id FROM records WHERE ${where.sql}`, where.params)).rows.map((r) => r.id), [1]);
    } finally { await pg.close(); }
});
