import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

test("UX-036 일반 필드의 필수 설정을 생성 시 저장하고 시스템 필드는 선택으로 고정한다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { generateToken } = await import("./auth");
    const { POST } = await import("../app/api/field-types/[id]/fields/route");
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000036", email: "test@example.test", name: "가상", role: "admin", tokenVersion: 0, membershipId: 71 } as never);
    for (const [isRequired, systemColumn, expected] of [[true, undefined, 1], [false, undefined, 0], [true, "registeredAt", 0]] as const) {
        await t.test(`${systemColumn ?? "custom"}:${isRequired}`, async (t) => {
            const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [{ role: "admin", tokenVersion: 0, membershipId: 71, isSuperAdmin: 0 }]
                : c.table === "field_types" ? [{ id: 1 }]
                : c.table === "field_definitions" ? c.op === "insert" ? [{ id: 10, key: systemColumn ?? "name" }] : [{ maxSort: 0 }]
                : c.table === "partitions" && c.op === "select" ? [{ id: 11, visibleFields: null }, { id: 12, visibleFields: [] }, { id: 13, visibleFields: ["old"] }] : []);
            const response = await POST(new NextRequest("http://localhost/api/field-types/1/fields", {
                method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: JSON.stringify({ key: "name", label: "이름", fieldType: "text", isRequired, systemColumn }),
            }), { params: Promise.resolve({ id: "1" }) });
            assert.equal(response.status, 201);
            const saved = calls.find((c) => c.op === "insert" && c.table === "field_definitions")?.values as { isRequired: number };
            assert.equal(saved.isRequired, expected);
            const visibilityUpdates = calls.filter((c) => c.op === "update" && c.table === "partitions");
            assert.equal(visibilityUpdates.length, 1);
            assert.ok(visibilityUpdates[0].params.includes(13));
        });
    }
});
