import { NextRequest, NextResponse } from "next/server";
import { db, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

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
