import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";
import { isCompleteRecordFilter } from "./record-filter-input";
import { buildRecordConditions, type RecordFilter } from "./record-filters";

test("UX-060·062 조건 삭제는 잘못된 JSON 필터를 400으로 거부하고 유효한 목록 조건만 삭제한다", async (t) => {
    isolateEnv(t);
    const { db, records } = await import("./db");
    const { generateToken } = await import("./auth");
    const { POST } = await import("../app/api/partitions/[id]/records/delete-all/route");
    const orgId = "00000000-0000-4000-8000-000000000060";
    const { calls } = installFakeDb(t, db, call => {
        if (isMembershipLookup(call)) return [{ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (call.table === "partitions" && call.op === "select") return [{ partition: { id: 7, workspaceId: 3, folderId: null }, workspace: { id: 3, orgId } }];
        if (call.table === "records" && call.op === "delete") return [{ id: 1 }];
        return [];
    });
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId, role: "owner", email: "fixture@example.test", name: "가상", tokenVersion: 0, membershipId: 71 } as never);
    const request = (body: string) => POST(new NextRequest("http://localhost/api/partitions/7/records/delete-all", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body,
    }), { params: Promise.resolve({ id: "7" }) });
    const invalidFilters: unknown[] = [
        ...[["equals"], ["is_empty"], ["gt"], [], {}, null, true, 1, "unknown", ""].map(operator => ({ field: "name", operator, value: 1 })),
        { field: ["name"], operator: "equals", value: "a" },
        { field: "name", operator: "equals", value: {} },
        { field: "name", operator: "equals", value: [] },
        { field: "name", operator: "equals", value: null },
        { field: "d", operator: "between", value: "2026-10-18", valueTo: ["2026-10-18"] },
        { field: "d", operator: "between", value: "2026-10-18", valueTo: {} },
        { field: "d", operator: "between", value: "2026-10-18", valueTo: null },
        null, [], {}, "equals", true, 1,
    ];
    for (const filter of invalidFilters) await t.test(`잘못된 필터 ${JSON.stringify(filter)}`, async () => {
        calls.length = 0;
        const response = await request(JSON.stringify({ filters: [filter] }));
        assert.equal(response.status, 400);
        assert.equal(isCompleteRecordFilter(filter), false);
        assert.equal((await response.json()).success, false);
        assert.equal(calls.filter(call => call.op !== "select").length, 0, "잘못된 조건은 쓰기를 실행하지 않는다");
    });
    for (const body of ["null", "[]", "{}", "true", "1", '"text"', "{", ...[null, [], {}, "equals"].map(filters => JSON.stringify({ filters }))]) await t.test(`잘못된 요청/빈 조건 ${body}`, async () => {
        calls.length = 0;
        assert.equal((await request(body)).status, 400);
        assert.equal(calls.filter(call => call.op !== "select").length, 0);
    });
    const valid: RecordFilter[] = [
        { field: "name", operator: "equals", value: "홍길동" },
        { field: "name", operator: "contains", value: "100%" },
        { field: "name", operator: "is_empty", value: null },
        { field: "n", operator: "gt", value: 0 },
        { field: "flag", operator: "is_false", value: null },
        { field: "d", operator: "between", value: "2026-10-18", valueTo: "2026-10-19" },
    ];
    const dialect = new PgDialect();
    for (const filter of valid) await t.test(`유효 조건 ${filter.operator}`, async () => {
        calls.length = 0;
        const response = await request(JSON.stringify({ filters: [filter] }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, data: { deletedCount: 1 } });
        const writes = calls.filter(call => call.op === "delete");
        assert.equal(writes.length, 1);
        const expected = dialect.sqlToQuery(and(eq(records.orgId, orgId), ...buildRecordConditions(7, { filters: [filter] }))!);
        assert.deepEqual({ sql: writes[0].sql, params: writes[0].params }, { sql: expected.sql, params: expected.params });
        assert.ok(writes[0].params.includes(orgId) && writes[0].params.includes(7));
        assert.match(writes[0].sql, /data/);
    });
});
