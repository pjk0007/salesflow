// UX-098 — 실패 웹훅 전달 일괄 재전달: 상태 조건(중복 발송 없음)·최대 100건·감사·권한. 가상 db, 외부 전송 없음.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000098";
const HOOK = "00000000-0000-4000-8000-0000000000b1";
const actor = { orgId: ORG, userId: "00000000-0000-4000-8000-000000000001", name: "가상 관리자", role: "admin" } as never;

async function setup(t: TestContext, opts: { enabled?: boolean; targets?: number; role?: "admin" | "member" }) {
    isolateEnv(t);
    const sent: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
        sent.push(String(input));
        return new Response("{}");
    });
    const { db } = await import("../db");
    const repo = await import("./webhook-repository");
    const ids = Array.from({ length: opts.targets ?? 3 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: opts.role ?? "admin", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "workspaces") return [{ id: 8 }];
        if (c.table === "customer_workspace_access") return [];
        if (c.op === "select" && c.table === "platform_webhooks")
            return [{ id: HOOK, orgId: ORG, workspaceId: 8, name: "가상 수신자", url: "https://receiver.example.test/hook", enabled: opts.enabled ?? true, generation: 4, version: 7 }];
        if (c.op === "select" && c.table === "platform_webhook_deliveries") return ids;
        if (c.op === "update" && c.table === "platform_webhook_deliveries") return ids;
        return [];
    });
    return { repo, calls, sent, writes: () => calls.filter((c) => c.op !== "select") };
}

test("UX-098 실패 전달을 상태 조건과 함께 대기열로 되돌리고 건마다 감사를 남긴다", async (t) => {
    const { repo, writes, sent } = await setup(t, { targets: 3 });
    const result = await repo.retryWebhookDeliveries(actor, HOOK, "dead");
    assert.deepEqual(result, { retried: 3, remaining: false });
    const update = writes().find((c) => c.op === "update")!;
    // 상태 조건: 그 사이 다른 관리자가 다시 보냈거나 전달 중이면 바꾸지 않는다(중복 발송 방지)
    assert.match(update.sql, /"state" = \$\d+/);
    assert.ok(update.params.includes("dead"));
    assert.match(update.sql, /"id" in \(/);
    assert.equal((update.set as { state: string }).state, "pending");
    assert.equal((update.set as { endpointVersion: number }).endpointVersion, 4);
    const audit = writes().find((c) => c.op === "insert" && c.table === "platform_webhook_audit")!;
    assert.equal((audit.values as unknown[]).length, 3);
    assert.equal(((audit.values as { action: string }[])[0]).action, "delivery.retried");
    // 대기열에 넣기만 하고 직접 전송하지 않는다
    assert.equal(sent.length, 0);
});

test("UX-098 한 번에 최대 100건, 남은 건이 있으면 알린다", async (t) => {
    const { repo, calls } = await setup(t, { targets: 100 });
    const result = await repo.retryWebhookDeliveries(actor, HOOK, "retry");
    assert.equal(result.remaining, true);
    assert.equal(repo.BULK_RETRY_LIMIT, 100);
    const select = calls.find((c) => c.op === "select" && c.table === "platform_webhook_deliveries")!;
    assert.ok(select.params.includes("retry"));
});

test("UX-098 꺼진 웹훅·운영 관리 권한 없음은 아무것도 바꾸지 않는다", async (t) => {
    await t.test("꺼진 웹훅", async (t) => {
        const { repo, writes } = await setup(t, { enabled: false });
        await assert.rejects(repo.retryWebhookDeliveries(actor, HOOK, "dead"), (e: unknown) => (e as { status?: number }).status === 409);
        assert.equal(writes().length, 0);
    });
    await t.test("일반 직원(사업 권한 없음)", async (t) => {
        const { repo, writes } = await setup(t, { role: "member" });
        await assert.rejects(repo.retryWebhookDeliveries({ ...(actor as object), role: "member" } as never, HOOK, "dead"), (e: unknown) => (e as { status?: number }).status === 403);
        assert.equal(writes().length, 0);
    });
});
