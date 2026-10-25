// UX-181 — 수동 알림톡 발송 결과의 제외 건수·레코드별 사유. 가상 db와 가상 공급자(fetch)만 쓴다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const link = { id: 9, partitionId: 11, senderKey: "sk", templateCode: "T1", templateName: "가상", recipientField: "phone", variableMappings: null, isActive: 1 };

async function setup(t: TestContext, recordRows: Array<{ id: number; data: Record<string, unknown> }>) {
    isolateEnv(t);
    const { generateToken } = await import("./auth");
    const { db } = await import("./db");
    const { POST } = await import("../app/api/alimtalk/send/route");
    const posted: string[] = [];
    installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "partitions") return [{ partition: { id: 11, workspaceId: 3, folderId: null, name: "가상" }, workspace: { id: 3, orgId: ORG } }];
        if (c.op === "select" && c.table === "alimtalk_template_links") return [{ alimtalk_template_links: link }];
        if (c.op === "select" && c.table === "alimtalk_configs") return [{ appKey: "fake", secretKey: "fake" }];
        if (c.op === "select" && c.table === "records") return recordRows.map(r => ({ ...r, partitionId: 11 }));
        if (c.op === "insert" && c.table === "alimtalk_send_logs") return (c.values as unknown[]).map((_, i) => ({ id: 500 + i }));
        return [];
    });
    t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
        if (init?.method !== "POST") return Response.json({ header: { isSuccessful: true, resultCode: 0 }, template: { templateContent: "가상 본문" } });
        posted.push(String(init.body));
        const { recipientList } = JSON.parse(String(init.body)) as { recipientList: Array<{ recipientNo: string }> };
        return Response.json({ header: { isSuccessful: true, resultCode: 0 }, message: { requestId: "fake", sendResults: recipientList.map((r, i) => ({ recipientNo: r.recipientNo, recipientSeq: i + 1, resultCode: 0 })) } });
    });
    const token = generateToken({ userId: USER, orgId: ORG, email: "a@example.test", name: "가상", role: "member", membershipId: 71, tokenVersion: 0 } as never);
    const send = (recordIds: number[]) => POST(new NextRequest("http://localhost/api/alimtalk/send", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ templateLinkId: 9, recordIds }),
    }));
    return { send, posted };
}

test("UX-181: 번호 없음·형식 오류와 정상 수신자를 섞으면 선택 합계 = 접수 + 제외, 레코드별 사유", async t => {
    const { send, posted } = await setup(t, [
        { id: 1, data: { phone: "010-1111-2222" } },
        { id: 2, data: {} },
        { id: 3, data: { phone: "010-12" } },
    ]);
    const res = await send([1, 2, 3]);
    assert.equal(res.status, 200);
    const body = await res.json() as { data: { totalCount: number; successCount: number; excludedCount: number; errors: Array<{ recordId: number; error: string }> } };
    assert.equal(body.data.totalCount, 3);
    assert.equal(body.data.successCount, 1);
    assert.equal(body.data.excludedCount, 2);
    assert.equal(body.data.successCount + body.data.excludedCount, body.data.totalCount);
    assert.deepEqual(body.data.errors.map(e => [e.recordId, e.error]).sort(), [[2, "수신번호 없음"], [3, "수신번호 형식 오류"]]);
    assert.equal(posted.length, 1);
    assert.doesNotMatch(posted[0], /010-12/);
});

test("UX-181: 전부 제외면 공급자 호출 없이 400과 레코드별 사유", async t => {
    const { send, posted } = await setup(t, [{ id: 2, data: {} }, { id: 3, data: { phone: "abc" } }]);
    const res = await send([2, 3]);
    assert.equal(res.status, 400);
    const body = await res.json() as { success: boolean; data: { errors: Array<{ recordId: number }> } };
    assert.equal(body.success, false);
    assert.deepEqual(body.data.errors.map(e => e.recordId).sort(), [2, 3]);
    assert.equal(posted.length, 0);
});
