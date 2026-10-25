import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, plans, subscriptions, payments } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { BillingProviderError, executeBilling } from "@/lib/billing";

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });
const UNCONFIRMED = "결제 결과를 확인 중입니다. 다시 결제하지 말고 고객센터에 문의해주세요.";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const user = auth.user;
    let attemptId: number | undefined;

    try {
        const { planSlug } = await req.json();
        if (typeof planSlug !== "string" || !planSlug) return fail("플랜을 선택해주세요.", 400);
        const [targetPlan] = await db.select().from(plans).where(eq(plans.slug, planSlug));
        if (!targetPlan) return fail("플랜을 찾을 수 없습니다.", 404);

        // 결제 전에 구독 행을 잠그고 pending을 영속화한다. 병렬 요청/응답 유실 뒤 재시도는 새 결제를 만들지 않는다.
        const prepared = await db.transaction(async (tx) => {
            const [currentSub] = await tx.select().from(subscriptions).where(and(
                eq(subscriptions.orgId, user.orgId), inArray(subscriptions.status, ["active", "suspended"])
            )).for("update");
            if (!currentSub) return { response: fail("구독 정보를 찾을 수 없습니다.", 400) };
            const [pending] = await tx.select({ id: payments.id }).from(payments).where(and(
                eq(payments.subscriptionId, currentSub.id), eq(payments.status, "pending")
            )).limit(1);
            if (pending) return { response: fail(UNCONFIRMED, 409) };
            if (currentSub.planId === targetPlan.id && currentSub.status === "active") {
                return { response: fail("이미 동일한 플랜을 사용 중입니다.", 400) };
            }
            if (targetPlan.price === 0) {
                if (user.role !== "owner") return { response: fail("소유자만 구독을 취소할 수 있습니다.", 403) };
                await tx.update(subscriptions).set({
                    planId: targetPlan.id, status: "active", currentPeriodStart: null, currentPeriodEnd: null,
                    canceledAt: new Date(), retryCount: 0, nextRetryAt: null, updatedAt: new Date(),
                }).where(eq(subscriptions.id, currentSub.id));
                return { response: NextResponse.json({ success: true, data: { plan: targetPlan.slug } }) };
            }
            if (!currentSub.tossBillingKey || !currentSub.tossCustomerKey) {
                return { response: NextResponse.json({ success: false, error: "결제 수단이 등록되지 않았습니다. 카드를 먼저 등록해주세요.", needBillingKey: true }, { status: 400 }) };
            }
            const orderId = `order_${randomUUID()}`;
            const [attempt] = await tx.insert(payments).values({
                orgId: user.orgId, subscriptionId: currentSub.id, amount: targetPlan.price,
                status: "pending", tossOrderId: orderId,
            }).returning({ id: payments.id });
            if (!attempt) throw new Error("결제 요청 저장 실패");
            return { currentSub, orderId, attemptId: attempt.id };
        });
        if (prepared.response) return prepared.response;
        attemptId = prepared.attemptId;
        const { currentSub, orderId } = prepared;
        const billingResult = await executeBilling(currentSub.tossBillingKey!, {
            customerKey: currentSub.tossCustomerKey!, amount: targetPlan.price,
            orderId, orderName: `Sendb ${targetPlan.name} 플랜`,
        });
        if (billingResult.status !== "DONE" || billingResult.orderId !== orderId || !billingResult.paymentKey) {
            throw new Error("결제 승인 응답 확인 실패");
        }
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await db.transaction(async (tx) => {
            const [updated] = await tx.update(subscriptions).set({
                planId: targetPlan.id, status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd,
                retryCount: 0, nextRetryAt: null, canceledAt: null, updatedAt: now,
            }).where(and(eq(subscriptions.id, currentSub.id), eq(subscriptions.orgId, user.orgId))).returning({ id: subscriptions.id });
            if (!updated) throw new Error("구독 반영 실패");
            const [payment] = await tx.update(payments).set({
                status: "done", tossPaymentKey: billingResult.paymentKey, paidAt: now,
            }).where(and(eq(payments.id, attemptId!), eq(payments.status, "pending"))).returning({ id: payments.id });
            if (!payment) throw new Error("결제 내역 반영 실패");
        });
        return NextResponse.json({ success: true, data: { plan: targetPlan.slug, paymentKey: billingResult.paymentKey } });
    } catch (error) {
        console.error("Subscribe error:", error);
        if (error instanceof BillingProviderError && attemptId !== undefined) {
            try {
                await db.update(payments).set({ status: "failed", failReason: error.message })
                    .where(and(eq(payments.id, attemptId), eq(payments.status, "pending")));
                return fail(error.message, 400);
            } catch {
                // 실패 확정 저장도 실패하면 pending을 보존하여 이중 결제를 막는다.
            }
        }
        return fail(attemptId !== undefined ? UNCONFIRMED : "결제 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", 500);
    }
}
