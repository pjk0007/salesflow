import type { NextApiRequest, NextApiResponse } from "next";
import { db, organizations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

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
        await db
            .update(organizations)
            .set({
                onboardingCompleted: true,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, user.orgId));

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Onboarding complete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
