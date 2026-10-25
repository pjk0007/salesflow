import { NextRequest, NextResponse } from "next/server";
import { db, subscriptions } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { BillingProviderError, issueBillingKey } from "@/lib/billing";

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const { authKey, customerKey } = await req.json();

        if (!authKey || !customerKey) {
            return NextResponse.json({ success: false, error: "authKey와 customerKey가 필요합니다." }, { status: 400 });
        }

        const [subscription] = await db.select({ id: subscriptions.id }).from(subscriptions).where(and(
            eq(subscriptions.orgId, user.orgId), inArray(subscriptions.status, ["active", "suspended"])
        ));
        if (!subscription) {
            return NextResponse.json({ success: false, error: "구독 정보를 찾을 수 없습니다." }, { status: 404 });
        }

        // 토스 API로 빌링키 발급
        const result = await issueBillingKey(authKey, customerKey);

        // 구독에 빌링키 + 카드 정보 저장
        const cardInfo = result.card
            ? { cardCompany: result.card.cardCompany, cardNumber: result.card.number }
            : null;

        const [updated] = await db
            .update(subscriptions)
            .set({
                tossBillingKey: result.billingKey,
                tossCustomerKey: result.customerKey,
                cardInfo,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.orgId, user.orgId),
                    eq(subscriptions.id, subscription.id),
                    inArray(subscriptions.status, ["active", "suspended"])
                )
            ).returning({ id: subscriptions.id });

        if (!updated) {
            return NextResponse.json({ success: false, error: "카드 정보를 저장하지 못했습니다. 구독 상태를 확인해주세요." }, { status: 409 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Issue billing key error:", error);
        const message = error instanceof BillingProviderError ? error.message : "카드 정보를 저장하지 못했습니다. 고객센터에 문의해주세요.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
