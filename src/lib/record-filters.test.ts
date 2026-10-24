import test from "node:test";
import assert from "node:assert/strict";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { openPglite } from "./db/pglite-harness.test-helper";
import { buildRecordConditions, type RecordFilter } from "./record-filters";

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
    await pg.exec(`CREATE TABLE "records" ("id" integer PRIMARY KEY, "partition_id" integer NOT NULL, "data" jsonb NOT NULL)`);
    for (const [id, partitionId, data] of ROWS) {
        await pg.query(`INSERT INTO "records" ("id","partition_id","data") VALUES ($1,$2,$3)`, [id, partitionId, JSON.stringify(data)]);
    }
    return pg;
}

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
