import { randomUUID } from "node:crypto";
import { db, plans, subscriptions, payments, workspaces, records, organizationMembers } from "@/lib/db";
import { eq, and, count, lte, gt, isNotNull, isNull, or } from "drizzle-orm";

// 토스페이먼츠 API
const TOSS_API_BASE = "https://api.tosspayments.com/v1";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";
const getAuthHeader = () =>
    `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString("base64")}`;

/** 공급자가 명시적으로 거절한 요청만 실패 확정으로 취급한다. 통신/서버 오류는 결과 미확인이다. */
export class BillingProviderError extends Error {}

export async function issueBillingKey(authKey: string, customerKey: string) {
    const res = await fetch(`${TOSS_API_BASE}/billing/authorizations/issue`, {
        method: "POST",
        headers: {
            Authorization: getAuthHeader(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ authKey, customerKey }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new BillingProviderError(err.message || "빌링키 발급 실패");
    }

    return res.json() as Promise<{
        billingKey: string;
        customerKey: string;
        card?: { cardCompany: string; number: string };
    }>;
}

export async function executeBilling(
    billingKey: string,
    params: {
        customerKey: string;
        amount: number;
        orderId: string;
        orderName: string;
    }
) {
    const res = await fetch(`${TOSS_API_BASE}/billing/${billingKey}`, {
        method: "POST",
        headers: {
            Authorization: getAuthHeader(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
    });

    if (!res.ok) {
        const err = await res.json();
        if (res.status >= 400 && res.status < 500 && res.status !== 408) {
            throw new BillingProviderError(err.message || "결제 실행 실패");
        }
        throw new Error("결제 결과를 확인할 수 없습니다.");
    }

    return res.json() as Promise<{
        paymentKey: string;
        orderId: string;
        status: string;
        approvedAt: string;
    }>;
}

export async function getActiveSubscription(orgId: string) {
    const [sub] = await db
        .select({
            id: subscriptions.id,
            orgId: subscriptions.orgId,
            planId: subscriptions.planId,
            status: subscriptions.status,
            currentPeriodStart: subscriptions.currentPeriodStart,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            tossCustomerKey: subscriptions.tossCustomerKey,
            tossBillingKey: subscriptions.tossBillingKey,
            canceledAt: subscriptions.canceledAt,
            createdAt: subscriptions.createdAt,
            updatedAt: subscriptions.updatedAt,
            planName: plans.name,
            planSlug: plans.slug,
            planPrice: plans.price,
            planLimits: plans.limits,
            planFeatures: plans.features,
        })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(
            and(
                eq(subscriptions.orgId, orgId),
                or(eq(subscriptions.status, "active"), eq(subscriptions.status, "suspended"))
            )
        );

    return sub ?? null;
}

export async function checkPlanLimit(
    orgId: string,
    resource: "workspaces" | "records" | "members",
    currentCount: number
): Promise<{ allowed: boolean; limit: number; plan: string }> {
    const sub = await getActiveSubscription(orgId);

    if (!sub) {
        return { allowed: false, limit: 0, plan: "none" };
    }

    // 정지된 구독도 Free 한도로 유입을 받는다. 과거 정지 행(planId=free)과 원 플랜을 보존한 행 모두 지원한다.
    const [freePlan] = sub.status === "suspended"
        ? await db.select().from(plans).where(eq(plans.slug, "free"))
        : [];
    if (sub.status === "suspended" && !freePlan) return { allowed: false, limit: 0, plan: "none" };
    const limits = (freePlan?.limits ?? sub.planLimits) as { workspaces: number; records: number; members: number };
    const limit = limits[resource];
    const planName = freePlan?.name ?? sub.planName;

    // -1 = 무제한
    if (limit === -1) {
        return { allowed: true, limit: -1, plan: planName };
    }

    return {
        allowed: currentCount < limit,
        limit,
        plan: planName,
    };
}

export async function getResourceCount(
    orgId: string,
    resource: "workspaces" | "records" | "members"
): Promise<number> {
    if (resource === "workspaces") {
        const [result] = await db
            .select({ count: count() })
            .from(workspaces)
            .where(eq(workspaces.orgId, orgId));
        return result?.count ?? 0;
    }

    if (resource === "records") {
        const [result] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.orgId, orgId));
        return result?.count ?? 0;
    }

    if (resource === "members") {
        const [result] = await db
            .select({ count: count() })
            .from(organizationMembers)
            .where(eq(organizationMembers.organizationId, orgId));
        return result?.count ?? 0;
    }

    return 0;
}

// ============================================
// 자동 갱신 / 재시도 / 일시정지
// ============================================

const RETRY_INTERVALS = [1, 3, 7]; // days
const PAYMENT_UNCONFIRMED = "결제 결과를 확인 중입니다. 고객센터에서 결제 상태를 확인해야 합니다.";

type ScheduledMode = "renew" | "retry";

/** 수동 플랜 변경과 같은 구독 행 잠금/pending 계약. 외부 호출 전에 짧은 트랜잭션을 커밋한다. */
async function claimScheduledPayment(id: number, mode: ScheduledMode, now: Date) {
    return db.transaction(async (tx) => {
        const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
        if (!sub || sub.status !== "active" || !sub.tossBillingKey || !sub.tossCustomerKey) return null;
        const due = mode === "renew" ? sub.currentPeriodEnd : sub.nextRetryAt;
        if (!due || due > now || (mode === "renew" ? sub.retryCount !== 0 : sub.retryCount <= 0)) return null;
        const [pending] = await tx.select({ id: payments.id }).from(payments).where(and(
            eq(payments.subscriptionId, sub.id), eq(payments.status, "pending")
        )).limit(1);
        if (pending) return null;
        const [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId));
        if (!plan || plan.price === 0) return null;
        const orderId = `${mode}_${randomUUID()}`;
        const [attempt] = await tx.insert(payments).values({
            orgId: sub.orgId, subscriptionId: sub.id, amount: plan.price,
            status: "pending", tossOrderId: orderId,
        }).returning({ id: payments.id });
        if (!attempt) throw new Error("결제 요청을 저장하지 못했습니다.");
        return { sub, plan, orderId, attemptId: attempt.id };
    });
}

async function processScheduledPayments(mode: ScheduledMode) {
    const now = new Date();
    const result = { succeeded: 0, failed: 0, suspended: 0, errors: [] as string[] };
    if (mode === "renew") {
        // 오래 남은 미확인 결제를 먼저 공급자 기록으로 확정해야 다음 갱신·재시도가 막히지 않는다(재시도 건도 함께 대사된다)
        try {
            const reconciled = await reconcilePendingPayments({ now });
            if (reconciled.unresolved > 0) result.errors.push(`미확인 결제 ${reconciled.unresolved}건: ${PAYMENT_UNCONFIRMED}`);
        } catch {
            result.errors.push(`미확인 결제 대사 실패: ${PAYMENT_UNCONFIRMED}`);
        }
    }
    const candidates = await db.select({ id: subscriptions.id }).from(subscriptions).where(and(
        eq(subscriptions.status, "active"), isNotNull(subscriptions.tossBillingKey),
        mode === "renew"
            ? and(lte(subscriptions.currentPeriodEnd, now), eq(subscriptions.retryCount, 0))
            : and(lte(subscriptions.nextRetryAt, now), gt(subscriptions.retryCount, 0))
    ));
    for (const candidate of candidates) {
        const attempt = await claimScheduledPayment(candidate.id, mode, now);
        if (!attempt) continue;
        const { sub, plan, orderId, attemptId } = attempt;
        try {
            const approved = await executeBilling(sub.tossBillingKey!, {
                customerKey: sub.tossCustomerKey!, amount: plan.price, orderId,
                orderName: `Sendb ${plan.name} 플랜 갱신${mode === "retry" ? " (재시도)" : ""}`,
            });
            if (approved.status !== "DONE" || approved.orderId !== orderId || !approved.paymentKey) {
                throw new Error("결제 승인 응답 확인 실패");
            }
            const periodStart = new Date();
            const periodEnd = new Date(periodStart);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            await db.transaction(async (tx) => {
                const [updated] = await tx.update(subscriptions).set({
                    currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
                    retryCount: 0, nextRetryAt: null, updatedAt: periodStart,
                }).where(eq(subscriptions.id, sub.id)).returning({ id: subscriptions.id });
                if (!updated) throw new Error("구독 반영 실패");
                const [payment] = await tx.update(payments).set({
                    status: "done", tossPaymentKey: approved.paymentKey, paidAt: periodStart,
                }).where(and(eq(payments.id, attemptId), eq(payments.status, "pending"))).returning({ id: payments.id });
                if (!payment) throw new Error("결제 내역 반영 실패");
            });
            result.succeeded++;
        } catch (error) {
            result.failed++;
            if (!(error instanceof BillingProviderError)) {
                // 승인 뒤 DB 오류/응답 유실을 실패 재결제로 바꾸지 않는다. pending으로 다음 자동·수동 시도를 막는다.
                result.errors.push(`org ${sub.orgId}: ${PAYMENT_UNCONFIRMED}`);
                continue;
            }
            const nextCount = mode === "renew" ? 1 : sub.retryCount + 1;
            const suspended = nextCount >= 3;
            try {
                await db.transaction(async (tx) => {
                    const nextRetry = new Date();
                    nextRetry.setDate(nextRetry.getDate() + RETRY_INTERVALS[Math.min(nextCount - 1, RETRY_INTERVALS.length - 1)]);
                    // 정지 전 플랜을 보존한다. checkPlanLimit이 suspended일 때 Free 한도를 적용한다.
                    await tx.update(subscriptions).set({
                        ...(suspended ? { status: "suspended" } : {}),
                        retryCount: suspended ? 0 : nextCount, nextRetryAt: suspended ? null : nextRetry,
                        updatedAt: new Date(),
                    }).where(eq(subscriptions.id, sub.id));
                    await tx.update(payments).set({ status: "failed", failReason: error.message })
                        .where(and(eq(payments.id, attemptId), eq(payments.status, "pending")));
                });
                if (suspended) result.suspended++;
                result.errors.push(`org ${sub.orgId}: ${error.message}`);
            } catch {
                result.errors.push(`org ${sub.orgId}: ${PAYMENT_UNCONFIRMED}`);
            }
        }
    }
    return result;
}

export async function processRenewals(): Promise<{ renewed: number; failed: number; downgraded: number; errors: string[] }> {
    const downgraded = await downgradeExpiredWithoutCard(new Date());
    const result = await processScheduledPayments("renew");
    return { renewed: result.succeeded, failed: result.failed, downgraded, errors: result.errors };
}

/**
 * 카드를 지운 유료 구독은 자동 갱신 대상이 아니다. 기간이 끝나면 구독 취소와 같은 값으로 Free에 내린다(UX-025).
 * 카드를 다시 등록한 구독은 조건에서 빠져 정상 갱신된다.
 */
async function downgradeExpiredWithoutCard(now: Date): Promise<number> {
    const [freePlan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, "free"));
    if (!freePlan) return 0;
    const unbillable = and(
        eq(subscriptions.status, "active"), lte(subscriptions.currentPeriodEnd, now), isNull(subscriptions.tossBillingKey)
    );
    const expired = await db.select({ id: subscriptions.id }).from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(and(unbillable, gt(plans.price, 0)));
    let downgraded = 0;
    for (const sub of expired) {
        const [updated] = await db.update(subscriptions).set({
            planId: freePlan.id, currentPeriodStart: null, currentPeriodEnd: null,
            canceledAt: now, retryCount: 0, nextRetryAt: null, updatedAt: now,
        }).where(and(eq(subscriptions.id, sub.id), unbillable)).returning({ id: subscriptions.id });
        if (updated) downgraded++;
    }
    return downgraded;
}

export async function processRetries(): Promise<{ retried: number; suspended: number; errors: string[] }> {
    const result = await processScheduledPayments("retry");
    return { retried: result.succeeded, suspended: result.suspended, errors: result.errors };
}

export async function suspendSubscription(subscriptionId: number): Promise<void> {
    await db.update(subscriptions).set({
        status: "suspended", retryCount: 0, nextRetryAt: null, updatedAt: new Date(),
    }).where(eq(subscriptions.id, subscriptionId));
}

// ============================================
// 결과 미확인(pending) 결제 대사
// ============================================

/** 승인 요청이 아직 진행 중일 수 있는 시간. 이보다 오래된 pending만 공급자에 조회한다. */
const PENDING_RECONCILE_AFTER_MS = 15 * 60 * 1000;

interface ProviderPayment {
    status: string;
    orderId: string;
    paymentKey?: string;
    approvedAt?: string | null;
    totalAmount?: number;
}

/** 주문 ID로 공급자 결제를 조회한다. 결제 기록이 없으면 null, 그 밖의 실패는 결과 미확인으로 던진다. */
export async function findProviderPaymentByOrderId(orderId: string): Promise<ProviderPayment | null> {
    const res = await fetch(`${TOSS_API_BASE}/payments/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: getAuthHeader() },
    });
    if (res.ok) return res.json() as Promise<ProviderPayment>;
    const err = await res.json().catch(() => ({}));
    if (res.status === 404 && err.code === "NOT_FOUND_PAYMENT") return null;
    throw new Error("결제 조회 결과를 확인할 수 없습니다.");
}

/**
 * 오래된 pending 결제를 공급자 주문 조회로 확정한다(UX-024). 같은 주문으로 다시 결제하지 않는다.
 * - 승인 기록 없음·승인 실패·만료 → failed로 풀어 다음 결제를 허용
 * - 승인 완료 → 원래 성공 분기와 같이 구독·내역을 한 트랜잭션으로 반영
 * - 그 밖(조회 실패·금액 불일치·부분 취소 등) → pending 유지, 운영자 확인
 */
export async function reconcilePendingPayments(options: { orgId?: string; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const result = { confirmed: 0, released: 0, unresolved: 0 };
    const pendings = await db.select({
        id: payments.id, subscriptionId: payments.subscriptionId, amount: payments.amount, tossOrderId: payments.tossOrderId,
    }).from(payments).where(and(
        eq(payments.status, "pending"),
        lte(payments.createdAt, new Date(now.getTime() - PENDING_RECONCILE_AFTER_MS)),
        ...(options.orgId ? [eq(payments.orgId, options.orgId)] : []),
    ));
    for (const row of pendings) {
        try {
            const { tossOrderId, subscriptionId } = row;
            if (!tossOrderId || !subscriptionId) { result.unresolved++; continue; }
            const found = await findProviderPaymentByOrderId(tossOrderId);
            const settle = async (status: "failed" | "canceled", failReason: string) => {
                await db.update(payments).set({ status, failReason })
                    .where(and(eq(payments.id, row.id), eq(payments.status, "pending")));
                result.released++;
            };
            if (!found || found.status === "ABORTED" || found.status === "EXPIRED") {
                await settle("failed", "공급자에 승인된 결제가 없어 실패로 확정했습니다.");
                continue;
            }
            if (found.status === "CANCELED") {
                await settle("canceled", "공급자에서 취소된 결제입니다.");
                continue;
            }
            if (found.status !== "DONE" || found.orderId !== tossOrderId || !found.paymentKey || found.totalAmount !== row.amount) {
                result.unresolved++;
                continue;
            }
            const applied = await applyConfirmedPayment({ id: row.id, subscriptionId, amount: row.amount, tossOrderId }, found.paymentKey, found.approvedAt, now);
            if (applied) result.confirmed++;
            else result.unresolved++;
        } catch {
            result.unresolved++;
        }
    }
    return result;
}

/** 대사로 확인된 승인을 반영한다. 수동 주문은 금액이 같은 플랜이 하나일 때만 플랜을 바꾼다. */
async function applyConfirmedPayment(
    row: { id: number; subscriptionId: number; amount: number; tossOrderId: string },
    paymentKey: string,
    approvedAt: string | null | undefined,
    now: Date,
): Promise<boolean> {
    let planId: number | undefined;
    if (row.tossOrderId.startsWith("order_")) {
        const matches = await db.select({ id: plans.id }).from(plans).where(eq(plans.price, row.amount));
        if (matches.length !== 1) return false;
        planId = matches[0].id;
    }
    const approved = approvedAt ? new Date(approvedAt) : null;
    const periodStart = approved && !Number.isNaN(approved.getTime()) ? approved : now;
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    return db.transaction(async (tx) => {
        const [payment] = await tx.update(payments).set({ status: "done", tossPaymentKey: paymentKey, paidAt: periodStart })
            .where(and(eq(payments.id, row.id), eq(payments.status, "pending"))).returning({ id: payments.id });
        if (!payment) return false;
        const [updated] = await tx.update(subscriptions).set({
            ...(planId !== undefined ? { planId, canceledAt: null } : {}),
            status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
            retryCount: 0, nextRetryAt: null, updatedAt: now,
        }).where(eq(subscriptions.id, row.subscriptionId)).returning({ id: subscriptions.id });
        if (!updated) throw new Error("구독 반영 실패");
        return true;
    });
}
