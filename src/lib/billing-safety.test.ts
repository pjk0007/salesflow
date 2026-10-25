// 가상 DB·fetch만 사용. 실제 DB/마이그레이션/외부 결제 없음.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const free = { id: 1, slug: "free", name: "Free", price: 0, limits: { records: 100, workspaces: 1, members: 3 } };
const pro = { id: 2, slug: "pro", name: "Pro", price: 10000, limits: { records: 1000, workspaces: 10, members: 20 } };

async function fixture(t: TestContext, options: { suspended?: boolean; role?: "owner" | "member"; failApply?: boolean; failPrepare?: boolean } = {}) {
    isolateEnv(t, { TOSS_SECRET_KEY: "fake-toss-key" });
    const auth = await import("./auth");
    const { db } = await import("./db");
    const billing = await import("./billing");
    const subscribe = await import("../app/api/billing/subscribe/route");
    const issue = await import("../app/api/billing/issue-billing-key/route");
    const remove = await import("../app/api/billing/delete-billing-key/route");
    const cancel = await import("../app/api/billing/cancel/route");
    let sub: Record<string, unknown> = {
        id: 10, orgId: ORG, planId: 1, status: options.suspended ? "suspended" : "active",
        tossBillingKey: "fake-card", tossCustomerKey: "fake-customer",
        retryCount: 2, nextRetryAt: new Date(), canceledAt: null,
        planName: "Free", planLimits: free.limits,
    };
    let paymentRows: Array<Record<string, unknown>> = [];
    let providerCalls = 0;
    let provider: (call: { url: string; body: Record<string, unknown> }) => Promise<Response> = async ({ body, url }) =>
        url.includes("/authorizations/issue")
            ? Response.json({ billingKey: "new-fake-card", customerKey: "fake-customer" })
            : Response.json({ status: "DONE", orderId: body.orderId, paymentKey: "fake-payment" });
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: options.role ?? "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "plans") return [c.params.includes("free") || c.params.includes(1) ? free : pro];
        if (c.table === "subscriptions") {
            if (c.op === "select") return [{ ...sub }];
            if (c.op === "update") {
                if (options.failApply && (c.set as Record<string, unknown>).planId === 2) return new Error("SQL UPDATE subscriptions SECRET");
                sub = { ...sub, ...c.set as Record<string, unknown> };
                return [{ id: 10 }];
            }
        }
        if (c.table === "payments") {
            if (c.op === "select") return paymentRows.filter((p) => p.status === "pending");
            if (c.op === "insert") {
                if (options.failPrepare) return new Error("SQL INSERT payments SECRET");
                const row = { ...c.values as Record<string, unknown>, id: paymentRows.length + 1 };
                paymentRows.push(row);
                return [row];
            }
            if (c.op === "update") {
                const row = paymentRows.find((p) => c.params.includes(p.id) && p.status === "pending");
                if (!row) return [];
                Object.assign(row, c.set);
                return [{ id: row.id }];
            }
        }
        return [];
    });
    // 메모리 fixture의 트랜잭션 직렬화·롤백. 실제 PostgreSQL 잠금 실행 검증을 대신하지 않는다.
    let tail = Promise.resolve();
    t.mock.method(db, "transaction", (fn: (tx: typeof db) => Promise<unknown>) => {
        const operation = tail.then(async () => {
            const beforeSub = structuredClone(sub);
            const beforeRows = structuredClone(paymentRows);
            try { return await fn(db); }
            catch (error) { sub = beforeSub; paymentRows = beforeRows; throw error; }
        });
        tail = operation.then(() => {}, () => {});
        return operation;
    });
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        providerCalls++;
        return provider({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    });
    t.mock.method(console, "error", () => {});
    const token = auth.generateToken({ userId: USER, orgId: ORG, email: "a@example.test", name: "가상", role: options.role ?? "owner", membershipId: 71, tokenVersion: 0 });
    const request = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/billing/${path}`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    return {
        calls, billing, db, issue, remove, cancel, request,
        subscribe: (planSlug = "pro") => subscribe.POST(request("subscribe", { planSlug })),
        sub: () => sub, payments: () => paymentRows, providerCalls: () => providerCalls,
        provider: (next: typeof provider) => { provider = next; },
        setSub: (values: Record<string, unknown>) => { Object.assign(sub, values); },
    };
}

test("UX-019 정지 구독은 결제 승인 후 active·재시도 초기화, Free 한도로 유입 유지", async (t) => {
    const f = await fixture(t, { suspended: true });
    assert.deepEqual(await f.billing.checkPlanLimit(ORG, "records", 99), { allowed: true, limit: 100, plan: "Free" });
    assert.equal((await f.subscribe()).status, 200);
    assert.equal(f.sub().status, "active");
    assert.equal(f.sub().retryCount, 0);
    assert.equal(f.sub().nextRetryAt, null);
    assert.equal(f.payments()[0].status, "done");
    assert.equal(f.providerCalls(), 1);
    assert.ok(f.calls.some((c) => c.table === "subscriptions" && c.op === "select" && c.params.includes("suspended") && c.params.includes(ORG)));
});

test("UX-024 승인 뒤 DB 실패는 내부 SQL을 숨기고 pending 보존, 재시도는 추가 결제하지 않는다", async (t) => {
    const f = await fixture(t, { failApply: true });
    const first = await f.subscribe();
    assert.equal(first.status, 500);
    const body = await first.json();
    assert.match(body.error, /결제 결과를 확인 중/);
    assert.doesNotMatch(body.error, /SQL|SECRET/);
    assert.equal(f.payments()[0].status, "pending");
    assert.equal(f.sub().planId, 1);
    assert.equal((await f.subscribe()).status, 409);
    assert.equal(f.providerCalls(), 1);
});

test("UX-024 통신 오류는 결제 실패로 단정하지 않고 재결제를 차단한다", async (t) => {
    const f = await fixture(t);
    f.provider(async () => { throw new Error("network lost after approval"); });
    assert.equal((await f.subscribe()).status, 500);
    assert.equal((await f.subscribe()).status, 409);
    assert.equal(f.payments()[0].status, "pending");
    assert.equal(f.providerCalls(), 1);
});

test("UX-024 결제 시도 저장에 실패하면 공급자를 호출하지 않는다", async (t) => {
    const f = await fixture(t, { failPrepare: true });
    const res = await f.subscribe();
    assert.equal(res.status, 500);
    assert.doesNotMatch((await res.json()).error, /SQL|SECRET/);
    assert.equal(f.providerCalls(), 0);
});

test("UX-024 공급자 명시적 거절은 실패 내역과 한국어 오류를 남긴다", async (t) => {
    const f = await fixture(t);
    f.provider(async () => Response.json({ message: "카드 승인이 거절되었습니다." }, { status: 400 }));
    const res = await f.subscribe();
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "카드 승인이 거절되었습니다.");
    assert.equal(f.payments()[0].status, "failed");
    assert.equal(f.sub().planId, 1);
});

test("UX-024 결제 승인 대기 중 중복 요청은 pending에서 차단한다", async (t) => {
    const f = await fixture(t);
    let release!: () => void;
    let started!: () => void;
    const signal = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.provider(async ({ body }) => {
        started();
        await gate;
        return Response.json({ status: "DONE", orderId: body.orderId, paymentKey: "fake-payment" });
    });
    const first = f.subscribe();
    await signal;
    assert.equal((await f.subscribe()).status, 409);
    release();
    assert.equal((await first).status, 200);
    assert.equal(f.providerCalls(), 1);
});

test("UX-014 일반 멤버는 결제·카드 변경·삭제·취소를 수행하지 못한다", async (t) => {
    const f = await fixture(t, { role: "member" });
    assert.equal((await f.subscribe()).status, 403);
    assert.equal((await f.issue.POST(f.request("issue-billing-key", { authKey: "fake", customerKey: "fake" }))).status, 403);
    assert.equal((await f.remove.POST(f.request("delete-billing-key"))).status, 403);
    assert.equal((await f.cancel.POST(f.request("cancel"))).status, 403);
    assert.equal(f.providerCalls(), 0);
    assert.equal(f.calls.filter((c) => c.op !== "select").length, 0);
});

test("UX-019 정지 구독의 카드 갱신을 저장하며 아직 결제하지 않는다", async (t) => {
    const f = await fixture(t, { suspended: true });
    assert.equal((await f.issue.POST(f.request("issue-billing-key", { authKey: "fake", customerKey: "fake" }))).status, 200);
    assert.equal(f.sub().tossBillingKey, "new-fake-card");
    assert.equal(f.sub().status, "suspended");
    assert.equal(f.providerCalls(), 1);
});

test("UX-025 유료 active 구독은 카드 삭제를 막고 해지 후 삭제를 허용한다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2 });
    assert.equal((await f.remove.POST(f.request("delete-billing-key"))).status, 409);
    assert.equal(f.sub().tossBillingKey, "fake-card");
    assert.equal((await f.cancel.POST(f.request("cancel"))).status, 200);
    assert.equal(f.sub().retryCount, 0);
    assert.equal((await f.remove.POST(f.request("delete-billing-key"))).status, 200);
    assert.equal(f.sub().tossBillingKey, null);
});

test("UX-024 미확인 결제가 남으면 취소와 카드 삭제도 구독을 바꾸지 않는다", async (t) => {
    const f = await fixture(t);
    f.provider(async () => { throw new Error("network"); });
    await f.subscribe();
    assert.equal((await f.cancel.POST(f.request("cancel"))).status, 409);
    assert.equal((await f.remove.POST(f.request("delete-billing-key"))).status, 409);
    assert.equal(f.sub().tossBillingKey, "fake-card");
});

test("UX-019 자동 갱신 성공은 내역과 새 기간을 함께 반영한다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0) });
    const result = await f.billing.processRenewals();
    assert.equal(result.renewed, 1);
    assert.equal(f.providerCalls(), 1);
    assert.equal(f.payments()[0].status, "done");
    assert.ok((f.sub().currentPeriodEnd as Date) > new Date());
    assert.equal((await f.billing.processRenewals()).renewed, 0);
    assert.equal(f.providerCalls(), 1);
});

test("UX-019 자동 재시도 최종 거절은 원 플랜을 보존하고 정지한다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2, retryCount: 2, nextRetryAt: new Date(0) });
    f.provider(async () => Response.json({ message: "카드 승인이 거절되었습니다." }, { status: 400 }));
    assert.equal((await f.billing.processRetries()).suspended, 1);
    assert.equal(f.sub().status, "suspended");
    assert.equal(f.sub().planId, 2);
    assert.equal(f.payments()[0].status, "failed");
    assert.equal((await f.billing.checkPlanLimit(ORG, "records", 99)).limit, 100);
});

test("UX-024 자동 갱신 응답 유실 후 자동·수동 재결제는 모두 차단된다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0) });
    f.provider(async () => { throw new Error("approval response lost"); });
    const result = await f.billing.processRenewals();
    assert.equal(result.failed, 1);
    assert.match(result.errors[0], /결제 결과를 확인 중/);
    assert.equal(f.payments()[0].status, "pending");
    assert.equal((await f.billing.processRenewals()).renewed, 0);
    assert.equal((await f.subscribe()).status, 409);
    assert.equal(f.providerCalls(), 1);
});

test("UX-024 수동 결제 응답 유실 후 자동 갱신도 동일 pending을 존중한다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0), status: "suspended" });
    f.provider(async () => { throw new Error("approval response lost"); });
    await f.subscribe();
    f.setSub({ status: "active" });
    await f.billing.processRenewals();
    assert.equal(f.providerCalls(), 1);
});

test("UX-024 승인 응답의 주문 ID/상태가 다르면 구독을 바꾸지 않는다", async (t) => {
    const f = await fixture(t);
    f.provider(async () => Response.json({ status: "DONE", orderId: "other-order", paymentKey: "fake-payment" }));
    assert.equal((await f.subscribe()).status, 500);
    assert.equal(f.sub().planId, 1);
    assert.equal(f.payments()[0].status, "pending");
});
