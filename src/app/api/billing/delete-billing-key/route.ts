import { NextRequest, NextResponse } from "next/server";
import { db, subscriptions, plans, payments } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const result = await db.transaction(async (tx) => {
            const [sub] = await tx.select().from(subscriptions).where(and(
                eq(subscriptions.orgId, user.orgId), inArray(subscriptions.status, ["active", "suspended"])
            )).for("update");
            if (!sub) return { error: "구독 정보를 찾을 수 없습니다.", status: 404 };
            const [plan] = await tx.select({ price: plans.price }).from(plans).where(eq(plans.id, sub.planId));
            if (!plan || (sub.status === "active" && plan.price > 0)) {
                return { error: "유료 구독은 먼저 구독을 취소한 뒤 결제 수단을 삭제해주세요.", status: 409 };
            }
            const [pending] = await tx.select({ id: payments.id }).from(payments).where(and(
                eq(payments.subscriptionId, sub.id), eq(payments.status, "pending")
            )).limit(1);
            if (pending) return { error: "확인 중인 결제가 있습니다. 고객센터에 문의해주세요.", status: 409 };
            await tx
            .update(subscriptions)
            .set({
                tossBillingKey: null,
                tossCustomerKey: null,
                cardInfo: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.id, sub.id)
                )
            );
            return null;
        });
        if (result) return NextResponse.json({ success: false, error: result.error }, { status: result.status });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete billing key error:", error);
        return NextResponse.json({ success: false, error: "결제 수단 삭제에 실패했습니다." }, { status: 500 });
    }
}
