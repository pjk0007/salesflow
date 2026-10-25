// 가상 DB·fetch만 사용. 실제 DB/마이그레이션/외부 결제 없음.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const free = { id: 1, slug: "free", name: "Free", price: 0, limits: { records: 100, workspaces: 1, members: 3 } };
const pro = { id: 2, slug: "pro", name: "Pro", price: 10000, limits: { records: 1000, workspaces: 10, members: 20 } };

async function fixture(t: TestContext, options: { suspended?: boolean; role?: "owner" | "member"; failApply?: boolean; failPrepare?: boolean; cardSaveMisses?: boolean } = {}) {
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
            // 카드 없는 만료 구독 정리(UX-025)의 조건만 메모리 상태로 판정한다
            if (c.sql.includes('"subscriptions"."toss_billing_key" is null') && sub.tossBillingKey) return [];
            if (c.op === "select") return [{ ...sub }];
            if (c.op === "update") {
                if (options.cardSaveMisses && "tossBillingKey" in (c.set as Record<string, unknown>)) return [];
                if (options.failApply && (c.set as Record<string, unknown>).planId === 2) return new Error("SQL UPDATE subscriptions SECRET");
                sub = { ...sub, ...c.set as Record<string, unknown> };
                return [{ id: 10 }];
            }
        }
        if (c.table === "payments") {
            if (c.op === "select") {
                const pending = paymentRows.filter((p) => p.status === "pending");
                // 대사 대상은 15분 넘게 남은 pending뿐이다(진행 중일 수 있는 요청은 조회하지 않는다)
                if (!c.sql.includes('"payments"."created_at"')) return pending;
                const cutoff = Date.now() - 15 * 60 * 1000;
                return pending.filter((p) => p.createdAt instanceof Date && p.createdAt.getTime() <= cutoff);
            }
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
        addPayment: (row: Record<string, unknown>) => { paymentRows.push({ id: paymentRows.length + 1, orgId: ORG, subscriptionId: 10, ...row }); },
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

const STALE = () => new Date(Date.now() - 60 * 60 * 1000);
const orderLookup = (url: string) => url.includes("/payments/orders/");

test("UX-024 오래된 수동 결제 pending은 공급자 승인 기록으로 확정하고 같은 주문을 다시 결제하지 않는다", async (t) => {
    const f = await fixture(t);
    f.addPayment({ status: "pending", amount: 10000, tossOrderId: "order_stale", createdAt: STALE() });
    f.provider(async ({ url }) => orderLookup(url)
        ? Response.json({ status: "DONE", orderId: "order_stale", paymentKey: "fake-approved", totalAmount: 10000, approvedAt: "2026-10-01T00:00:00+09:00" })
        : Response.json({ status: "DONE", orderId: "unexpected", paymentKey: "x" }));
    assert.deepEqual(await f.billing.reconcilePendingPayments(), { confirmed: 1, released: 0, unresolved: 0 });
    assert.equal(f.payments()[0].status, "done");
    assert.equal(f.payments()[0].tossPaymentKey, "fake-approved");
    assert.equal(f.sub().planId, 2);
    assert.equal(f.sub().status, "active");
    // 확정 뒤 같은 플랜을 다시 고르면 결제 없이 '이미 동일한 플랜'
    assert.equal((await f.subscribe()).status, 400);
    assert.equal(f.providerCalls(), 1, "주문 조회 1회뿐, 승인 요청 없음");
});

test("UX-024 공급자에 승인 기록이 없는 pending은 실패로 풀어 다시 결제할 수 있다", async (t) => {
    const f = await fixture(t);
    f.addPayment({ status: "pending", amount: 10000, tossOrderId: "order_lost", createdAt: STALE() });
    const charged: string[] = [];
    f.provider(async ({ url, body }) => {
        if (orderLookup(url)) return Response.json({ code: "NOT_FOUND_PAYMENT", message: "존재하지 않는 결제 정보 입니다." }, { status: 404 });
        charged.push(String(body.orderId));
        return Response.json({ status: "DONE", orderId: body.orderId, paymentKey: "fake-payment" });
    });
    assert.equal((await f.subscribe()).status, 200);
    assert.equal(f.payments()[0].status, "failed");
    assert.equal(charged.length, 1);
    assert.notEqual(charged[0], "order_lost", "새 주문 번호로 1회만 결제");
    assert.equal(f.sub().planId, 2);
});

test("UX-024 주문 조회도 실패하면 pending을 유지하고 결제하지 않는다", async (t) => {
    const f = await fixture(t);
    f.addPayment({ status: "pending", amount: 10000, tossOrderId: "order_unknown", createdAt: STALE() });
    let charges = 0;
    f.provider(async ({ url }) => {
        if (orderLookup(url)) throw new Error("network");
        charges++;
        return Response.json({});
    });
    assert.equal((await f.subscribe()).status, 409);
    assert.equal(f.payments()[0].status, "pending");
    assert.equal(charges, 0);
    // 금액이 다른 승인 기록도 확정하지 않는다
    f.provider(async () => Response.json({ status: "DONE", orderId: "order_unknown", paymentKey: "k", totalAmount: 99 }));
    assert.deepEqual(await f.billing.reconcilePendingPayments(), { confirmed: 0, released: 0, unresolved: 1 });
    assert.equal(f.payments()[0].status, "pending");
});

test("UX-024 자동 갱신 pending은 대사로 기간만 연장하고 같은 갱신을 다시 결제하지 않는다", async (t) => {
    const f = await fixture(t);
    f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0) });
    f.addPayment({ status: "pending", amount: 10000, tossOrderId: "renew_stale", createdAt: STALE() });
    let charges = 0;
    f.provider(async ({ url }) => {
        if (orderLookup(url)) return Response.json({ status: "DONE", orderId: "renew_stale", paymentKey: "fake-renew", totalAmount: 10000, approvedAt: new Date().toISOString() });
        charges++;
        return Response.json({});
    });
    const result = await f.billing.processRenewals();
    assert.equal(result.renewed, 0);
    assert.equal(charges, 0);
    assert.equal(f.payments()[0].status, "done");
    assert.equal(f.sub().planId, 2);
    assert.ok((f.sub().currentPeriodEnd as Date) > new Date());
});

test("UX-025 카드 없이 기간이 끝난 유료 구독은 갱신 때 Free로 내려가고, 카드가 있으면 그대로 갱신된다", async (t) => {
    await t.test("카드 없음 → Free 전환, 결제 호출 없음", async (t) => {
        const f = await fixture(t);
        f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0), tossBillingKey: null, tossCustomerKey: null });
        const result = await f.billing.processRenewals();
        assert.equal(result.downgraded, 1);
        assert.equal(f.sub().planId, 1);
        assert.equal(f.sub().currentPeriodEnd, null);
        assert.ok(f.sub().canceledAt instanceof Date);
        assert.equal(f.providerCalls(), 0);
    });
    await t.test("카드 있음 → 전환 없이 갱신 결제", async (t) => {
        const f = await fixture(t);
        f.setSub({ planId: 2, retryCount: 0, currentPeriodEnd: new Date(0) });
        const result = await f.billing.processRenewals();
        assert.equal(result.downgraded, 0);
        assert.equal(result.renewed, 1);
        assert.equal(f.sub().planId, 2);
    });
});

test("UX-019 카드 저장이 0행이면 성공 대신 409로 알린다", async (t) => {
    const f = await fixture(t, { suspended: true, cardSaveMisses: true });
    const res = await f.issue.POST(f.request("issue-billing-key", { authKey: "fake", customerKey: "fake" }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /카드 정보를 저장하지 못했습니다/);
    assert.equal(f.sub().tossBillingKey, "fake-card");
});
