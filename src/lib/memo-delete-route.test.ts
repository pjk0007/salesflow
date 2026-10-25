import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";
import { canDeleteMemo, MEMO_DELETE_FORBIDDEN } from "./memo-permissions";

// UX-059 — 메모 삭제는 작성자 본인 또는 관리자만. 다른 사람 메모는 member가 지울 수 없다.

const ORG = "00000000-0000-4000-8000-000000000059";
const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

test("canDeleteMemo: 관리자는 모두, member는 본인 메모만, 작성자 없는 메모는 관리자만", () => {
    assert.equal(canDeleteMemo({ createdBy: AUTHOR }, { userId: AUTHOR, role: "member" }), true);
    assert.equal(canDeleteMemo({ createdBy: AUTHOR }, { userId: OTHER, role: "member" }), false);
    assert.equal(canDeleteMemo({ createdBy: AUTHOR }, { userId: OTHER, role: "admin" }), true);
    assert.equal(canDeleteMemo({ createdBy: AUTHOR }, { userId: OTHER, role: "owner" }), true);
    assert.equal(canDeleteMemo({ createdBy: null }, { userId: OTHER, role: "member" }), false);
});

for (const [name, role, userId, expected] of [
    ["다른 사람 메모를 member가 삭제 → 403, 삭제 없음", "member", OTHER, 403],
    ["본인 메모를 member가 삭제 → 200", "member", AUTHOR, 200],
    ["다른 사람 메모를 admin이 삭제 → 200", "admin", OTHER, 200],
] as const) {
    test(`메모 삭제 API: ${name}`, async (t) => {
        isolateEnv(t);
        const { db } = await import("./db");
        const { generateToken } = await import("./auth");
        const { DELETE } = await import("../app/api/records/[id]/memos/[memoId]/route");
        const { calls } = installFakeDb(t, db, (call) => {
            if (isMembershipLookup(call)) return [{ role, membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
            // requireRecordAccess: 레코드+파티션(같은 조직)
            if (call.table === "records" && call.op === "select") {
                return [{ record: { id: 5, partitionId: 7, orgId: ORG }, partition: { id: 7, workspaceId: 3, folderId: null } }];
            }
            // member 파티션 권한: 조직 전체 읽기 허용 scope
            if (call.table === "member_scopes" && call.op === "select") {
                return [{ userId, scopeType: "org", scopeId: 0, permissions: { read: true, create: true, update: true, delete: true } }];
            }
            if (call.table === "memos" && call.op === "select") return [{ id: 9, createdBy: AUTHOR }];
            if (call.table === "memos" && call.op === "delete") return [{ id: 9 }];
            return [];
        });
        const token = generateToken({ userId, orgId: ORG, role, email: "fixture@example.test", name: "가상", tokenVersion: 0, membershipId: 71 } as never);
        const res = await DELETE(
            new NextRequest("http://localhost/api/records/5/memos/9", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }),
            { params: Promise.resolve({ id: "5", memoId: "9" }) },
        );
        const body = await res.json();
        const deletes = calls.filter((c) => c.op === "delete");
        if (expected === 403) {
            assert.equal(res.status, 403);
            assert.deepEqual(body, { success: false, error: MEMO_DELETE_FORBIDDEN });
            assert.equal(deletes.length, 0);
        } else {
            assert.equal(res.status, 200, JSON.stringify(body));
            assert.deepEqual(body, { success: true });
            assert.equal(deletes.length, 1);
        }
    });
}
