import type { NextApiRequest, NextApiResponse } from "next";
import { db, plans, subscriptions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    if (user.role !== "owner") {
        return res.status(403).json({ success: false, error: "소유자만 구독을 취소할 수 있습니다." });
    }

    try {
        // Free 플랜 조회
        const [freePlan] = await db
            .select({ id: plans.id })
            .from(plans)
            .where(eq(plans.slug, "free"));

        if (!freePlan) {
            return res.status(500).json({ success: false, error: "Free 플랜을 찾을 수 없습니다." });
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
            return res.status(404).json({ success: false, error: "활성 구독을 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Cancel subscription error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
