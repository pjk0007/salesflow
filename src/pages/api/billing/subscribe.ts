import type { NextApiRequest, NextApiResponse } from "next";
import { db, plans, subscriptions, payments } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { executeBilling } from "@/lib/billing";
import crypto from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    try {
        const { planSlug } = req.body;

        if (!planSlug) {
            return res.status(400).json({ success: false, error: "플랜을 선택해주세요." });
        }

        // 타겟 플랜 조회
        const [targetPlan] = await db
            .select()
            .from(plans)
            .where(eq(plans.slug, planSlug));

        if (!targetPlan) {
            return res.status(404).json({ success: false, error: "플랜을 찾을 수 없습니다." });
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
            return res.status(400).json({ success: false, error: "구독 정보를 찾을 수 없습니다." });
        }

        // 이미 같은 플랜이면
        if (currentSub.planId === targetPlan.id) {
            return res.status(400).json({ success: false, error: "이미 동일한 플랜을 사용 중입니다." });
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

            return res.status(200).json({ success: true, data: { plan: targetPlan.slug } });
        }

        // 유료 플랜 → 빌링키 필수
        if (!currentSub.tossBillingKey || !currentSub.tossCustomerKey) {
            return res.status(400).json({
                success: false,
                error: "결제 수단이 등록되지 않았습니다. 카드를 먼저 등록해주세요.",
                needBillingKey: true,
            });
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

        return res.status(200).json({
            success: true,
            data: { plan: targetPlan.slug, paymentKey: billingResult.paymentKey },
        });
    } catch (error) {
        console.error("Subscribe error:", error);
        const message = error instanceof Error ? error.message : "결제에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
