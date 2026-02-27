import { NextRequest, NextResponse } from "next/server";
import { db, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        await db
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
                    eq(subscriptions.status, "active")
                )
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete billing key error:", error);
        return NextResponse.json({ success: false, error: "결제 수단 삭제에 실패했습니다." }, { status: 500 });
    }
}
