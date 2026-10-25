import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";
const orgId = "00000000-0000-4000-8000-000000000001", userId = "00000000-0000-4000-8000-000000000002";

test("UX-155: 현재 member/manager는 설정 쓰기 금지, admin/owner만 허용", async t => {
    for (const role of ["member", "manager", "admin", "owner"] as const) for (const existing of [true, false]) await t.test(`${role}/${existing ? "변경" : "생성"}`, async t => {
        isolateEnv(t);
        const { db } = await import("./db"), { generateToken } = await import("./auth");
        const { POST, GET } = await import("../app/api/email/config/route");
        const { calls } = installFakeDb(t, db, c => {
            if (isMembershipLookup(c)) return [{ membershipId: 71, role, tokenVersion: 0, isSuperAdmin: 0 }];
            if (c.op === "select" && c.table === "email_configs") { assert(c.params.includes(orgId)); return existing ? [{ id: 3, appKey: "fake", secretKey: "fake-only-secret" }] : []; }
            if (c.op === "insert" && c.table === "email_configs") { assert.equal((c.values as {orgId:string}).orgId, orgId); return [{id: 3}]; }
            return [];
        });
        t.mock.method(globalThis, "fetch", async () => { throw Error("NETWORK FORBIDDEN"); });
        // JWT는 admin이어도 DB의 현재 역할이 낮으면 거부한다.
        const session = { userId, orgId, membershipId: 71, name: "가상", email: "staff@example.test", role: "admin" as const, tokenVersion: 0 };
        const token = generateToken(session);
        const headers = { authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const response = await POST(new NextRequest("https://example.test/api/email/config", { method: "POST", headers, body: JSON.stringify({ appKey: "fake-replacement", secretKey: "fake-replacement-secret" }) }));
        const allowed = role === "admin" || role === "owner";
        assert.equal(response.status, allowed ? (existing ? 200 : 201) : 403);
        assert.equal(calls.filter(c => c.op === "update" || c.op === "insert").length, allowed ? 1 : 0);
        if (!allowed) assert.match((await response.json()).error, /관리자/);
        assert.equal((await GET(new NextRequest("https://example.test/api/email/config", { headers }))).status, 200);
    });
});

test("최초 템플릿 자동 동시 호출: 같은/다른 레코드의 같은 주소는 1회만, 응답 유실도 재발송 금지", async t => {
    for (const lost of [false, true]) for (const sameRecord of [false, true]) await t.test(`${lost ? "응답 유실" : "접수"}/${sameRecord ? "동일 레코드" : "다른 레코드"}`, async t => {
        isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://example.test" });
        const { db } = await import("./db");
        const { processEmailAutoTrigger } = await import("./email-automation");
        let posts = 0, nextLog = 0, status = "", activeTx = 0;
        const { calls } = installFakeDb(t, db, c => {
            if (c.op === "select" && c.table === "email_template_links") return [{ id: 7, partitionId: 3, emailTemplateId: 9, recipientField: "email", isActive: 1, preventDuplicate: true }];
            if (c.op === "select" && c.table === "email_send_logs") return status ? [{ id: 1 }] : [];
            if (c.table === "email_configs") return [{ fromEmail: "sender@example.test", appKey: "fake", secretKey: "fake", isActive: 1 }];
            if (c.table === "email_templates") return [{ id: 9, subject: "가상", htmlBody: "가상", useUnsubscribe: false }];
            if (c.table === "partitions") return [{ workspaceId: 2 }];
            if (c.table === "workspaces") return [{ orgId, id: 2 }];
            if (c.op === "insert" && c.table === "email_send_logs") { assert.equal(activeTx, 1); status = "pending"; return [{ id: ++nextLog }]; }
            if (c.op === "update" && c.table === "email_send_logs") status = (c.set as {status:string}).status;
            return [];
        });
        let tail = Promise.resolve(); const txScope = new AsyncLocalStorage<boolean>();
        t.mock.method(db, "transaction", async (fn: (tx: typeof db) => Promise<unknown>) => {
            const previous = tail; let release!: () => void;
            tail = new Promise<void>(resolve => { release = resolve; });
            await previous; activeTx++;
            try { return await txScope.run(true, () => fn(db)); } finally { activeTx--; release(); }
        });
        t.mock.method(globalThis, "fetch", async () => {
            assert.notEqual(txScope.getStore(), true, "외부 발송은 짧은 claim 트랜잭션 커밋 뒤"); posts++;
            if (lost) throw Error("fake accepted then response lost");
            return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "accepted" }, body: { data: { requestId: "fake-id", results: [{ resultCode: 0 }] } } });
        });
        const request = (id: number) => ({ record: { id, data: { email: "recipient@example.test" } } as never, orgId, partitionId: 3, triggerType: "on_create" as const });
        const results = await Promise.allSettled([processEmailAutoTrigger(request(1)), processEmailAutoTrigger(request(sameRecord ? 1 : 2))]);
        assert.equal(posts, 1); assert.equal(nextLog, 1);
        assert.equal(results.filter(r => r.status === "rejected").length, lost ? 1 : 0);
        assert.equal(status, lost ? "pending" : "sent");
        assert(calls.some(c => c.op === "execute" && c.sql.includes("pg_advisory_xact_lock")));
        assert(calls.some(c => c.op === "select" && c.table === "email_send_logs" && c.sql.includes("lower(trim(")), "정규화 수신자 중복 확인도 claim 안에서 실행");
        await processEmailAutoTrigger(request(1)); assert.equal(posts, 1);
    });
});
