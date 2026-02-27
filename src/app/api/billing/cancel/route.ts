import { NextRequest, NextResponse } from "next/server";
import { db, plans, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role !== "owner") {
        return NextResponse.json({ success: false, error: "소유자만 구독을 취소할 수 있습니다." }, { status: 403 });
    }

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
        const [updated] = await db
            .update(subscriptions)
            .set({
                planId: freePlan.id,
                status: "active",
                canceledAt: new Date(),
                currentPeriodStart: null,
                currentPeriodEnd: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.status, "active")
                )
            )
            .returning({ id: subscriptions.id });

        if (!updated) {
            return NextResponse.json({ success: false, error: "활성 구독을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Cancel subscription error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
