import { NextRequest, NextResponse } from "next/server";
import { db, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { issueBillingKey } from "@/lib/billing";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const { authKey, customerKey } = await req.json();

        if (!authKey || !customerKey) {
            return NextResponse.json({ success: false, error: "authKey와 customerKey가 필요합니다." }, { status: 400 });
        }

        // 토스 API로 빌링키 발급
        const result = await issueBillingKey(authKey, customerKey);

        // 구독에 빌링키 + 카드 정보 저장
        const cardInfo = result.card
            ? { cardCompany: result.card.cardCompany, cardNumber: result.card.number }
            : null;

        await db
            .update(subscriptions)
            .set({
                tossBillingKey: result.billingKey,
                tossCustomerKey: result.customerKey,
                ...(cardInfo ? { cardInfo } : {}),
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
        console.error("Issue billing key error:", error);
        const message = error instanceof Error ? error.message : "빌링키 발급에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
