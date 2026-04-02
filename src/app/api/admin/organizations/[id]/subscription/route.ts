import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, subscriptions, plans } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const { id: orgId } = await params;
    const { planId } = await req.json();

    if (!planId) {
        return NextResponse.json({ success: false, error: "planId가 필요합니다." }, { status: 400 });
    }

    // 플랜 존재 확인
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
    if (!plan) {
        return NextResponse.json({ success: false, error: "플랜을 찾을 수 없습니다." }, { status: 404 });
    }

    // 기존 활성 구독 찾기
    const [existingSub] = await db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, "active")));

    if (existingSub) {
        await db
            .update(subscriptions)
            .set({ planId, updatedAt: new Date() })
            .where(eq(subscriptions.id, existingSub.id));
    } else {
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await db.insert(subscriptions).values({
            orgId,
            planId,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
        });
    }

    return NextResponse.json({ success: true, message: `플랜이 ${plan.name}으로 변경되었습니다.` });
}
