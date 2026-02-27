import type { NextApiRequest, NextApiResponse } from "next";
import { db, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { issueBillingKey } from "@/lib/billing";

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
        const { authKey, customerKey } = req.body;

        if (!authKey || !customerKey) {
            return res.status(400).json({ success: false, error: "authKey와 customerKey가 필요합니다." });
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

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Issue billing key error:", error);
        const message = error instanceof Error ? error.message : "빌링키 발급에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
