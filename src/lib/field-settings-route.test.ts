import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

test("UX-030 속성 PATCH는 미지정 값을 유지하고 명시한 빈 문자열을 null로 바꾼다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { generateToken } = await import("./auth");
    const { PATCH } = await import("../app/api/fields/[id]/route");
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000030", email: "test@example.test", name: "가상", role: "admin", tokenVersion: 0, membershipId: 71 });
    const cases = [
        { name: "미지정 값 유지", input: { label: "수정" }, expected: { label: "수정" } },
        { name: "빈 값 삭제", input: { category: "", defaultValue: "", cellClassName: "" }, expected: { category: null, defaultValue: null, cellClassName: null } },
        { name: "기존 값과 선택 옵션 저장", input: { category: "분류", defaultValue: "B", cellClassName: "text-red-500", options: ["A", "B"] }, expected: { category: "분류", defaultValue: "B", cellClassName: "text-red-500", options: ["A", "B"] } },
    ];
    for (const item of cases) await t.test(item.name, async (t) => {
        const { calls } = installFakeDb(t, db, c => isMembershipLookup(c)
            ? [{ role: "admin", tokenVersion: 0, membershipId: 71, isSuperAdmin: 0 }]
            : c.op === "select" ? [{ field: { id: 30, fieldTypeId: 1 } }]
            : [{ id: 30, label: "수정" }]);
        const response = await PATCH(new NextRequest("http://localhost/api/fields/30", {
            method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(item.input),
        }), { params: Promise.resolve({ id: "30" }) });
        assert.equal(response.status, 200);
        const saved = calls.find(c => c.op === "update")?.set as Record<string, unknown>;
        assert.ok(saved.updatedAt instanceof Date);
        assert.deepEqual(Object.fromEntries(Object.entries(saved).filter(([key]) => key !== "updatedAt")), item.expected);
    });
});
