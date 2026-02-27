import { NextRequest, NextResponse } from "next/server";
import { db, plans, subscriptions, payments } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        // 현재 구독 + 플랜 정보
        const [sub] = await db
            .select({
                id: subscriptions.id,
                status: subscriptions.status,
                currentPeriodStart: subscriptions.currentPeriodStart,
                currentPeriodEnd: subscriptions.currentPeriodEnd,
                tossBillingKey: subscriptions.tossBillingKey,
                cardInfo: subscriptions.cardInfo,
                canceledAt: subscriptions.canceledAt,
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
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.status, "active")
                )
            );

        // 최근 결제 내역 (최대 10건)
        const recentPayments = await db
            .select({
                id: payments.id,
                amount: payments.amount,
                status: payments.status,
                tossOrderId: payments.tossOrderId,
                paidAt: payments.paidAt,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .where(eq(payments.orgId, user.orgId))
            .orderBy(desc(payments.createdAt))
            .limit(10);

        // 전체 플랜 목록
        const allPlans = await db
            .select({
                name: plans.name,
                slug: plans.slug,
                price: plans.price,
                limits: plans.limits,
                features: plans.features,
            })
            .from(plans)
            .orderBy(plans.sortOrder);

        return NextResponse.json({
            success: true,
            data: {
                plan: sub
                    ? {
                          name: sub.planName,
                          slug: sub.planSlug,
                          price: sub.planPrice,
                          limits: sub.planLimits,
                          features: sub.planFeatures,
                      }
                    : null,
                subscription: sub
                    ? {
                          status: sub.status,
                          currentPeriodStart: sub.currentPeriodStart,
                          currentPeriodEnd: sub.currentPeriodEnd,
                          hasBillingKey: !!sub.tossBillingKey,
                          cardInfo: sub.cardInfo ?? null,
                          canceledAt: sub.canceledAt,
                      }
                    : null,
                payments: recentPayments,
                allPlans,
            },
        });
    } catch (error) {
        console.error("Billing status error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
