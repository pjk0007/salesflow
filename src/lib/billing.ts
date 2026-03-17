import { db, plans, subscriptions, payments, workspaces, records, users, organizationMembers } from "@/lib/db";
import { eq, and, count, lte, gt, isNotNull, or } from "drizzle-orm";

// 토스페이먼츠 API
const TOSS_API_BASE = "https://api.tosspayments.com/v1";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";
const getAuthHeader = () =>
    `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString("base64")}`;

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
        throw new Error(err.message || "빌링키 발급 실패");
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
        throw new Error(err.message || "결제 실행 실패");
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
                eq(subscriptions.status, "active")
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

    const limits = sub.planLimits as { workspaces: number; records: number; members: number };
    const limit = limits[resource];

    // -1 = 무제한
    if (limit === -1) {
        return { allowed: true, limit: -1, plan: sub.planName };
    }

    return {
        allowed: currentCount < limit,
        limit,
        plan: sub.planName,
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

export async function processRenewals(): Promise<{
    renewed: number;
    failed: number;
    errors: string[];
}> {
    const now = new Date();
    const result = { renewed: 0, failed: 0, errors: [] as string[] };

    // 만료 예정/만료된 active 구독 (빌링키 있고, 아직 재시도 진입 전)
    const expiredSubs = await db
        .select({
            id: subscriptions.id,
            orgId: subscriptions.orgId,
            tossBillingKey: subscriptions.tossBillingKey,
            tossCustomerKey: subscriptions.tossCustomerKey,
            planId: subscriptions.planId,
        })
        .from(subscriptions)
        .where(
            and(
                eq(subscriptions.status, "active"),
                lte(subscriptions.currentPeriodEnd, now),
                isNotNull(subscriptions.tossBillingKey),
                eq(subscriptions.retryCount, 0)
            )
        );

    for (const sub of expiredSubs) {
        if (!sub.tossBillingKey || !sub.tossCustomerKey) continue;

        const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId));
        if (!plan || plan.price === 0) continue;

        const orderId = `renew_${sub.orgId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

        try {
            const billingResult = await executeBilling(sub.tossBillingKey, {
                customerKey: sub.tossCustomerKey,
                amount: plan.price,
                orderId,
                orderName: `Sendb ${plan.name} 플랜 갱신`,
            });

            const periodStart = new Date();
            const periodEnd = new Date();
            periodEnd.setMonth(periodEnd.getMonth() + 1);

            await db
                .update(subscriptions)
                .set({
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, sub.id));

            await db.insert(payments).values({
                orgId: sub.orgId,
                subscriptionId: sub.id,
                amount: plan.price,
                status: "done",
                tossPaymentKey: billingResult.paymentKey,
                tossOrderId: billingResult.orderId,
                paidAt: new Date(),
            });

            result.renewed++;
        } catch (error) {
            const reason = error instanceof Error ? error.message : "결제 실패";
            const nextRetry = new Date();
            nextRetry.setDate(nextRetry.getDate() + RETRY_INTERVALS[0]);

            await db
                .update(subscriptions)
                .set({
                    retryCount: 1,
                    nextRetryAt: nextRetry,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, sub.id));

            await db.insert(payments).values({
                orgId: sub.orgId,
                subscriptionId: sub.id,
                amount: plan.price,
                status: "failed",
                tossOrderId: orderId,
                failReason: reason,
            });

            result.failed++;
            result.errors.push(`org ${sub.orgId}: ${reason}`);
        }
    }

    return result;
}

export async function processRetries(): Promise<{
    retried: number;
    suspended: number;
    errors: string[];
}> {
    const now = new Date();
    const result = { retried: 0, suspended: 0, errors: [] as string[] };

    const retrySubs = await db
        .select({
            id: subscriptions.id,
            orgId: subscriptions.orgId,
            tossBillingKey: subscriptions.tossBillingKey,
            tossCustomerKey: subscriptions.tossCustomerKey,
            planId: subscriptions.planId,
            retryCount: subscriptions.retryCount,
        })
        .from(subscriptions)
        .where(
            and(
                eq(subscriptions.status, "active"),
                lte(subscriptions.nextRetryAt, now),
                gt(subscriptions.retryCount, 0)
            )
        );

    for (const sub of retrySubs) {
        if (!sub.tossBillingKey || !sub.tossCustomerKey) continue;

        const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId));
        if (!plan || plan.price === 0) continue;

        const orderId = `retry_${sub.orgId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

        try {
            const billingResult = await executeBilling(sub.tossBillingKey, {
                customerKey: sub.tossCustomerKey,
                amount: plan.price,
                orderId,
                orderName: `Sendb ${plan.name} 플랜 갱신 (재시도)`,
            });

            const periodStart = new Date();
            const periodEnd = new Date();
            periodEnd.setMonth(periodEnd.getMonth() + 1);

            await db
                .update(subscriptions)
                .set({
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    retryCount: 0,
                    nextRetryAt: null,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, sub.id));

            await db.insert(payments).values({
                orgId: sub.orgId,
                subscriptionId: sub.id,
                amount: plan.price,
                status: "done",
                tossPaymentKey: billingResult.paymentKey,
                tossOrderId: billingResult.orderId,
                paidAt: new Date(),
            });

            result.retried++;
        } catch (error) {
            const reason = error instanceof Error ? error.message : "결제 실패";
            const nextCount = sub.retryCount + 1;

            if (nextCount >= 3) {
                await suspendSubscription(sub.id);
                result.suspended++;
            } else {
                const nextRetry = new Date();
                nextRetry.setDate(nextRetry.getDate() + RETRY_INTERVALS[nextCount]);

                await db
                    .update(subscriptions)
                    .set({
                        retryCount: nextCount,
                        nextRetryAt: nextRetry,
                        updatedAt: new Date(),
                    })
                    .where(eq(subscriptions.id, sub.id));
            }

            await db.insert(payments).values({
                orgId: sub.orgId,
                subscriptionId: sub.id,
                amount: plan.price,
                status: "failed",
                tossOrderId: orderId,
                failReason: reason,
            });

            result.errors.push(`org ${sub.orgId}: ${reason}`);
        }
    }

    return result;
}

export async function suspendSubscription(subscriptionId: number): Promise<void> {
    const [freePlan] = await db
        .select()
        .from(plans)
        .where(eq(plans.slug, "free"));

    if (!freePlan) {
        throw new Error("Free 플랜을 찾을 수 없습니다.");
    }

    await db
        .update(subscriptions)
        .set({
            status: "suspended",
            planId: freePlan.id,
            retryCount: 0,
            nextRetryAt: null,
            updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscriptionId));
}
