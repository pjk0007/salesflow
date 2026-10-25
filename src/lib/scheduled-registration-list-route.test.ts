import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

// UX-078 — 대기 목록은 pending/skipped를 나눠 보고, 삭제는 고른 상태 안에서만 지운다.

const ORG = "00000000-0000-4000-8000-000000000078";

async function setup(t: TestContext) {
    isolateEnv(t);
    const { db } = await import("./db");
    const { generateToken } = await import("./auth");
    const route = await import("../app/api/partitions/[id]/scheduled-registrations/route");
    const { calls } = installFakeDb(t, db, (call) => {
        if (isMembershipLookup(call)) return [{ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (call.table === "partitions" && call.op === "select") {
            return [{ partition: { id: 7, workspaceId: 3, folderId: null, scheduledRegistrationConfig: null }, workspace: { id: 3, orgId: ORG } }];
        }
        if (call.table === "scheduled_registrations" && call.op === "select" && call.sql.includes("in (")) {
            return [{ status: "pending", total: 120 }, { status: "skipped", total: 3 }];
        }
        if (call.table === "scheduled_registrations" && call.op === "select") return [{ id: 1, data: {}, sourceFileName: null, createdAt: "2026-10-25" }];
        if (call.table === "scheduled_registrations" && call.op === "delete") return [{ id: 1 }, { id: 2 }];
        return [];
    });
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId: ORG, role: "owner", email: "fixture@example.test", name: "가상", tokenVersion: 0, membershipId: 71 } as never);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const ctx = { params: Promise.resolve({ id: "7" }) };
    return { calls, route, headers, ctx };
}

test("목록: status=skipped면 skipped 행만, 마지막을 넘는 page는 마지막 유효 페이지로, 건너뜀 건수 포함", async (t) => {
    const { calls, route, headers, ctx } = await setup(t);
    const res = await route.GET(new NextRequest("http://localhost/api/partitions/7/scheduled-registrations?page=9&status=skipped", { headers }), ctx);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.status, "skipped");
    assert.equal(body.data.total, 3);
    assert.equal(body.data.skippedTotal, 3);
    assert.equal(body.data.page, 1, "3건이면 1페이지");
    const list = calls.filter((c) => c.table === "scheduled_registrations" && c.op === "select" && !c.sql.includes("in ("));
    assert.equal(list.length, 1);
    assert.ok(list[0].params.includes("skipped"));
    assert.ok(!list[0].params.includes("pending"));
});

test("목록: status 생략·알 수 없는 값은 pending, 120건 3페이지 요청은 그대로", async (t) => {
    const { route, headers, ctx } = await setup(t);
    const res = await route.GET(new NextRequest("http://localhost/api/partitions/7/scheduled-registrations?page=3&status=registered", { headers }), ctx);
    const body = await res.json();
    assert.deepEqual([body.data.status, body.data.total, body.data.page, body.data.totalPages, body.data.pageSize], ["pending", 120, 3, 3, 50]);
});

test("삭제: 선택 id와 상태 범위로만 지운다(registered 같은 값은 pending으로 본다)", async (t) => {
    const { calls, route, headers, ctx } = await setup(t);
    const res = await route.DELETE(new NextRequest("http://localhost/api/partitions/7/scheduled-registrations", {
        method: "DELETE", headers, body: JSON.stringify({ ids: [1, 2], status: "skipped" }),
    }), ctx);
    assert.deepEqual(await res.json(), { success: true, data: { deleted: 2 } });
    const del = calls.filter((c) => c.op === "delete");
    assert.equal(del.length, 1);
    assert.ok(del[0].params.includes("skipped") && del[0].params.includes(1) && del[0].params.includes(2));

    calls.length = 0;
    await route.DELETE(new NextRequest("http://localhost/api/partitions/7/scheduled-registrations", {
        method: "DELETE", headers, body: JSON.stringify({ status: "registered" }),
    }), ctx);
    const all = calls.filter((c) => c.op === "delete");
    assert.ok(all[0].params.includes("pending") && !all[0].params.includes("registered"));
});
