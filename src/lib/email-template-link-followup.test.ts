/**
 * UX-229: 수동 발송 연결에는 후속 설정을 저장하지 않는다 (수동 발송 API는 후속 큐를 만들지 않으므로 저장해도 나가지 않는다).
 * 자동(생성 시·수정 시) 연결은 기존처럼 저장한다. 가상 db만 쓴다.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const FOLLOWUP = [{ delayDays: 3, onClicked: { templateId: 9 }, onNotClicked: { templateId: 9 } }];

async function setup(t: TestContext, savedTrigger: string) {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "email_template_links") {
            return [{ email_template_links: { id: 5, triggerType: savedTrigger, partitionId: 3 }, partitions: { id: 3 }, workspaces: { id: 2, orgId } }];
        }
        if (c.op === "select" && c.table === "partitions") return [{ partitions: { id: 3 }, workspaces: { id: 2, orgId } }];
        if (c.op === "select" && c.table === "email_templates") return c.params.filter((p) => typeof p === "number").map((id) => ({ id }));
        if (c.op === "insert" || c.op === "update") return [{ id: 5 }];
        return [];
    });
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "admin", membershipId: 71, tokenVersion: 0 });
    const headers = { authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    return { calls, headers };
}

async function put(t: TestContext, savedTrigger: string, body: Record<string, unknown>) {
    const { calls, headers } = await setup(t, savedTrigger);
    const { PUT } = await import("../app/api/email/template-links/[id]/route");
    const res = await PUT(new NextRequest("https://example.test/api/email/template-links/5", { method: "PUT", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "5" }) });
    assert.equal(res.status, 200);
    return calls.find((c) => c.op === "update" && c.table === "email_template_links")!.set as Record<string, unknown>;
}

test("UX-229: 수동 연결 수정에 후속 설정을 보내도 저장하지 않는다 (예전 저장분도 비운다)", async (t) => {
    const set = await put(t, "manual", { name: "수동", followupConfig: FOLLOWUP });
    assert.equal(set.followupConfig, null);
});

test("UX-229: 자동 연결을 수동으로 바꾸면 후속 설정을 비운다", async (t) => {
    const set = await put(t, "on_create", { triggerType: "manual" });
    assert.equal(set.followupConfig, null);
});

test("UX-229: 생성 시·수정 시 연결의 후속 설정은 그대로 저장한다", async (t) => {
    for (const trigger of ["on_create", "on_update"]) {
        const set = await put(t, trigger, { followupConfig: FOLLOWUP });
        assert.deepEqual(set.followupConfig, FOLLOWUP, trigger);
    }
});

test("UX-229: 새 수동 연결은 후속 설정 없이 만든다 — 자동 연결은 저장", async (t) => {
    for (const [trigger, expected] of [["manual", null], ["on_create", FOLLOWUP]] as const) {
        const { calls, headers } = await setup(t, trigger);
        const { POST } = await import("../app/api/email/template-links/route");
        const res = await POST(new NextRequest("https://example.test/api/email/template-links", {
            method: "POST", headers,
            body: JSON.stringify({ partitionId: 3, name: "연결", emailTemplateId: 10, recipientField: "email", triggerType: trigger, followupConfig: FOLLOWUP }),
        }));
        assert.equal(res.status, 201, trigger);
        const insert = calls.filter((c) => c.op === "insert" && c.table === "email_template_links").at(-1)!;
        assert.deepEqual((insert.values as { followupConfig: unknown }).followupConfig, expected, trigger);
    }
});
