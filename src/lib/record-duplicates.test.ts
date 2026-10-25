import test from "node:test";
import assert from "node:assert/strict";

// UX-081 — 중복 표시는 현재 페이지가 아니라 파티션 전체 기준(메모리 PGlite, 마이그레이션 미적용).

const ORG = "00000000-0000-4000-8000-000000000081";

test("페이지에 1건만 보여도 다른 페이지에 같은 값이 있으면 중복, 다른 파티션·다른 조직·빈 값은 제외", async () => {
    process.env.DATABASE_URL ??= "postgres://fixture:fixture@127.0.0.1:1/fixture";
    const schema = await import("./db/schema");
    const { openPglite } = await import("./db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { findDuplicateValues, duplicateKeyOf } = await import("./record-duplicates");
    const pg = await openPglite([schema.records]);
    try {
        const db = drizzle(pg, { schema });
        const rows: [number, string, number, Record<string, unknown>][] = [
            [1, ORG, 7, { phone: "010-1" }], // 1페이지
            [2, ORG, 7, { phone: "010-2" }], // 1페이지
            [3, ORG, 7, { phone: "" }], // 1페이지 빈 값
            [100, ORG, 7, { phone: "010-1" }], // 다른 페이지의 중복
            [200, ORG, 8, { phone: "010-2" }], // 다른 파티션
            [300, "00000000-0000-4000-8000-000000000099", 7, { phone: "010-2" }], // 다른 조직
            [400, ORG, 7, { phone: "" }], // 빈 값끼리는 중복 아님
        ];
        for (const [id, orgId, partitionId, data] of rows) {
            await db.insert(schema.records).values({ id, orgId, workspaceId: 1, partitionId, data } as never);
        }
        const page = rows.slice(0, 3);
        const dup = await findDuplicateValues(db as never, {
            orgId: ORG,
            partitionId: 7,
            field: "phone",
            values: page.map(([, , , data]) => duplicateKeyOf(data, "phone")),
        });
        assert.deepEqual([...dup], ["010-1"]);
        assert.equal((await findDuplicateValues(db as never, { orgId: ORG, partitionId: 7, field: "phone", values: [""] })).size, 0);
        assert.equal(duplicateKeyOf({ n: 5 }, "n"), "5");
        assert.equal(duplicateKeyOf({}, "n"), "");
    } finally {
        await pg.close();
    }
});
