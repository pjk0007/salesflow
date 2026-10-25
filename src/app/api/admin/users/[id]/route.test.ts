// UX-008 — 슈퍼관리자 계정 변경: 자기 계정 정지·자기 권한 해제는 쓰기 전에 거부한다(가상 db, 실제 DB 없음).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isMembershipLookup, isolateEnv } from "@/lib/auth-fake-db.test-helper";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ORG = "00000000-0000-4000-8000-0000000000aa";

async function setup(t: TestContext) {
    isolateEnv(t);
    const { generateToken } = await import("@/lib/auth");
    const { db } = await import("@/lib/db");
    const { PATCH } = await import("./route");
    // 세션 확인(멤버십+계정 활성)에는 슈퍼관리자 행, 대상 조회에는 대상 행을 준다
    const { calls } = installFakeDb(t, db, (call) =>
        isMembershipLookup(call) ? [{ membershipId: 71, role: "owner", tokenVersion: 0, isSuperAdmin: 1 }]
            : call.op === "select" && call.table === "users" ? [{ id: call.params[0] }]
                : []);
    const token = generateToken({ userId: ADMIN, orgId: ORG, email: "admin@example.test", name: "운영자", role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: true });
    const patch = (targetId: string, body: unknown) => PATCH(
        new NextRequest(`http://localhost/api/admin/users/${targetId}`, {
            method: "PATCH",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: targetId }) },
    );
    return { calls, patch };
}

test("자기 계정 정지는 400, users 갱신 없음", async (t) => {
    const { calls, patch } = await setup(t);
    const res = await patch(ADMIN, { isActive: 0 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "자신의 계정은 정지할 수 없습니다.");
    assert.equal(calls.filter((c) => c.op === "update").length, 0);
});

test("자기 Super Admin 해제는 기존대로 400, users 갱신 없음", async (t) => {
    const { calls, patch } = await setup(t);
    const res = await patch(ADMIN, { isSuperAdmin: 0 });
    assert.equal(res.status, 400);
    assert.equal(calls.filter((c) => c.op === "update").length, 0);
});

test("다른 사용자 정지는 그대로 반영한다", async (t) => {
    const { calls, patch } = await setup(t);
    const res = await patch(OTHER, { isActive: 0 });
    assert.equal(res.status, 200);
    const update = calls.find((c) => c.op === "update");
    assert.equal(update?.table, "users");
    assert.equal((update?.set as { isActive?: number }).isActive, 0);
    assert.ok(update?.params.includes(OTHER));
});
