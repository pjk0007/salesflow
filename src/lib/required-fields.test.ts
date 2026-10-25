import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";
import { isBlankRequiredValue, missingRequiredFields } from "./required-fields";

test("UX-036 필수 빈 값 판정은 공백만 든 문자열도 비어 있다고 본다", () => {
    for (const blank of [undefined, null, "", "   ", "\t\n"]) assert.equal(isBlankRequiredValue(blank), true, JSON.stringify(blank));
    for (const filled of [" 가 ", 0, false, "0"]) assert.equal(isBlankRequiredValue(filled), false, JSON.stringify(filled));
});

test("UX-036 빠진 필수 필드는 직접 입력하는 필수 필드만 고른다", () => {
    const fields = [
        { key: "companyName", label: "상호명", fieldType: "text", cellType: null, isRequired: 1 },
        { key: "memo", label: "메모", fieldType: "text", cellType: null, isRequired: 0 },
        { key: "total", label: "합계", fieldType: "formula", cellType: null, isRequired: 1 },
        { key: "code", label: "코드", fieldType: "text", cellType: "readonly", isRequired: true },
        { key: "phone", label: "전화", fieldType: "phone", cellType: null, isRequired: true },
    ];
    assert.deepEqual(missingRequiredFields(fields, { companyName: "   ", memo: "" }).map((f) => f.key), ["companyName", "phone"]);
    assert.deepEqual(missingRequiredFields(fields, { companyName: "가상상사", phone: "010-0000-0000" }), []);
});

test("UX-036 화면 레코드 생성 API는 필수 칸이 공백뿐이면 400으로 막고 쓰지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { generateToken } = await import("./auth");
    const { POST } = await import("../app/api/partitions/[id]/records/route");
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000036", email: "test@example.test", name: "가상", role: "admin", tokenVersion: 0, membershipId: 71 } as never);
    for (const value of ["   ", ""]) {
        await t.test(JSON.stringify(value), async (t) => {
            const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [{ role: "admin", tokenVersion: 0, membershipId: 71, isSuperAdmin: 0 }]
                : c.table === "partitions" ? [{ partition: { id: 16, workspaceId: 14, folderId: null, fieldTypeId: 7 }, workspace: { id: 14, defaultFieldTypeId: null } }]
                : c.table === "field_definitions" ? [{ key: "companyName", label: "R6상호명", fieldType: "text", cellType: null, isRequired: 1 }, { key: "memo", label: "R6메모", fieldType: "text", cellType: null, isRequired: 0 }]
                : []);
            const response = await POST(new NextRequest("http://localhost/api/partitions/16/records", {
                method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: JSON.stringify({ data: { companyName: value, memo: "메모" } }),
            }), { params: Promise.resolve({ id: "16" }) });
            assert.equal(response.status, 400);
            const body = await response.json();
            assert.equal(body.error, "R6상호명은(는) 필수 항목입니다.");
            assert.equal(body.field, "companyName");
            const fieldQuery = calls.find((c) => c.table === "field_definitions");
            assert.ok(fieldQuery?.sql.includes('"field_type_id"') && fieldQuery.params.includes(7));
            assert.equal(calls.some((c) => c.op !== "select"), false);
        });
    }
});
