import { NextRequest, NextResponse } from "next/server";
import { db, plans, subscriptions, payments } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { executeBilling } from "@/lib/billing";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const { planSlug } = await req.json();

        if (!planSlug) {
            return NextResponse.json({ success: false, error: "플랜을 선택해주세요." }, { status: 400 });
        }

        // 타겟 플랜 조회
        const [targetPlan] = await db
            .select()
            .from(plans)
            .where(eq(plans.slug, planSlug));

        if (!targetPlan) {
            return NextResponse.json({ success: false, error: "플랜을 찾을 수 없습니다." }, { status: 404 });
        }

        // 현재 구독 조회
        const [currentSub] = await db
            .select()
            .from(subscriptions)
            .where(
                and(
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.status, "active")
                )
            );

        if (!currentSub) {
            return NextResponse.json({ success: false, error: "구독 정보를 찾을 수 없습니다." }, { status: 400 });
        }

        // 이미 같은 플랜이면
        if (currentSub.planId === targetPlan.id) {
            return NextResponse.json({ success: false, error: "이미 동일한 플랜을 사용 중입니다." }, { status: 400 });
        }

        // Free 플랜 다운그레이드 (결제 없이)
        if (targetPlan.price === 0) {
            await db
                .update(subscriptions)
                .set({
                    planId: targetPlan.id,
                    currentPeriodStart: null,
                    currentPeriodEnd: null,
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, currentSub.id));

            return NextResponse.json({ success: true, data: { plan: targetPlan.slug } });
        }

        // 유료 플랜 → 빌링키 필수
        if (!currentSub.tossBillingKey || !currentSub.tossCustomerKey) {
            return NextResponse.json({
                success: false,
                error: "결제 수단이 등록되지 않았습니다. 카드를 먼저 등록해주세요.",
                needBillingKey: true,
            }, { status: 400 });
        }

        // 결제 실행
        const orderId = `order_${user.orgId.slice(0, 8)}_${Date.now()}`;
        const billingResult = await executeBilling(currentSub.tossBillingKey, {
            customerKey: currentSub.tossCustomerKey,
            amount: targetPlan.price,
            orderId,
            orderName: `SalesFlow ${targetPlan.name} 플랜`,
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // 구독 업데이트
        await db
            .update(subscriptions)
            .set({
                planId: targetPlan.id,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                updatedAt: now,
            })
            .where(eq(subscriptions.id, currentSub.id));

        // 결제 내역 저장
        await db.insert(payments).values({
            orgId: user.orgId,
            subscriptionId: currentSub.id,
            amount: targetPlan.price,
            status: "done",
            tossPaymentKey: billingResult.paymentKey,
            tossOrderId: billingResult.orderId,
            paidAt: now,
        });

        return NextResponse.json({
            success: true,
            data: { plan: targetPlan.slug, paymentKey: billingResult.paymentKey },
        });
    } catch (error) {
        console.error("Subscribe error:", error);
        const message = error instanceof Error ? error.message : "결제에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
