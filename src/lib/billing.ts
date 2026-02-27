import { db, plans, subscriptions, workspaces, records, users, organizationMembers } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";

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
