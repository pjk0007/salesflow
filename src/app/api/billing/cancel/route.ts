import { NextRequest, NextResponse } from "next/server";
import { db, plans, subscriptions, payments } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req, "owner");
    if (!auth.ok) {
        const error = auth.status === 403 ? "소유자만 구독을 취소할 수 있습니다." : auth.error;
        return NextResponse.json({ success: false, error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        // Free 플랜 조회
        const [freePlan] = await db
            .select({ id: plans.id })
            .from(plans)
            .where(eq(plans.slug, "free"));

        if (!freePlan) {
            return NextResponse.json({ success: false, error: "Free 플랜을 찾을 수 없습니다." }, { status: 500 });
        }

        // 현재 구독을 Free로 다운그레이드
        const outcome = await db.transaction(async (tx) => {
            const [sub] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(and(
                eq(subscriptions.orgId, user.orgId), inArray(subscriptions.status, ["active", "suspended"])
            )).for("update");
            if (!sub) return "missing" as const;
            const [pending] = await tx.select({ id: payments.id }).from(payments).where(and(
                eq(payments.subscriptionId, sub.id), eq(payments.status, "pending")
            )).limit(1);
            if (pending) return "pending" as const;
            const [updated] = await tx
            .update(subscriptions)
            .set({
                planId: freePlan.id,
                status: "active",
                canceledAt: new Date(),
                currentPeriodStart: null,
                currentPeriodEnd: null,
                retryCount: 0,
                nextRetryAt: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.id, sub.id)
                )
            )
            .returning({ id: subscriptions.id });
            return updated ? "done" as const : "missing" as const;
        });

        if (outcome === "pending") {
            return NextResponse.json({ success: false, error: "확인 중인 결제가 있습니다. 다시 결제하거나 취소하지 말고 고객센터에 문의해주세요." }, { status: 409 });
        }
        if (outcome === "missing") {
            return NextResponse.json({ success: false, error: "활성 구독을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Cancel subscription error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
