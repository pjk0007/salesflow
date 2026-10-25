import test from "node:test";
import assert from "node:assert/strict";
import { inArray, eq } from "drizzle-orm";

// UX-064 — 단건·일괄·조건 삭제가 같은 함수로 방문자 연결을 끊는다(메모리 PGlite, 마이그레이션 미적용).

const ORG = "00000000-0000-4000-8000-000000000064";
const OTHER_ORG = "00000000-0000-4000-8000-000000000099";

async function setup() {
    process.env.DATABASE_URL ??= "postgres://fixture:fixture@127.0.0.1:1/fixture";
    const schema = await import("./db/schema");
    const { openPglite } = await import("./db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const pg = await openPglite([schema.records, schema.trackerVisitors]);
    const db = drizzle(pg, { schema });
    const rows = [
        { id: 1, orgId: ORG, workspaceId: 1, partitionId: 7, data: {} },
        { id: 2, orgId: ORG, workspaceId: 1, partitionId: 7, data: {} },
        { id: 3, orgId: ORG, workspaceId: 1, partitionId: 7, data: {} },
    ];
    for (const r of rows) await db.insert(schema.records).values(r as never);
    const visitors: [number, string, number | null][] = [
        [11, ORG, 1],
        [12, ORG, 2],
        [13, ORG, 3],
        [14, OTHER_ORG, 1], // 다른 조직의 같은 번호 — 건드리지 않는다
    ];
    for (const [id, orgId, recordId] of visitors) {
        await pg.query(`INSERT INTO "tracker_visitors" ("id","org_id","record_id","visitor_id","site_id") VALUES ($1,$2,$3,$4,1)`, [id, orgId, recordId, `v-${id}`]);
    }
    return { pg, db, schema };
}

async function visitorLinks(pg: { query: <T>(q: string) => Promise<{ rows: T[] }> }) {
    const { rows } = await pg.query<{ id: number; record_id: number | null }>(`SELECT id, record_id FROM "tracker_visitors" ORDER BY id`);
    return rows.map((r) => [r.id, r.record_id]);
}

test("삭제한 레코드의 방문자는 record_id가 비고, 남은 레코드·다른 조직 방문자는 그대로", async () => {
    const { pg, db, schema } = await setup();
    try {
        const { deleteRecordsWhere } = await import("./record-delete");
        const deleted = await deleteRecordsWhere(ORG, [inArray(schema.records.id, [1, 2])], db as never);
        assert.deepEqual(deleted.map((d) => d.id).sort(), [1, 2]);
        assert.deepEqual(await visitorLinks(pg), [[11, null], [12, null], [13, 3], [14, 1]]);
        // 단건 삭제도 같은 함수
        await deleteRecordsWhere(ORG, [eq(schema.records.id, 3)], db as never);
        assert.deepEqual(await visitorLinks(pg), [[11, null], [12, null], [13, null], [14, 1]]);
    } finally {
        await pg.close();
    }
});

test("다른 조직 레코드 id로는 지우지도 끊지도 않는다", async () => {
    const { pg, db, schema } = await setup();
    try {
        const { deleteRecordsWhere } = await import("./record-delete");
        const deleted = await deleteRecordsWhere(OTHER_ORG, [inArray(schema.records.id, [1, 2, 3])], db as never);
        assert.equal(deleted.length, 0);
        assert.deepEqual(await visitorLinks(pg), [[11, 1], [12, 2], [13, 3], [14, 1]]);
    } finally {
        await pg.close();
    }
});
