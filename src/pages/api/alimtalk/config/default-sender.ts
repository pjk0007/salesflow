import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "PUT") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const { senderKey } = req.body;
        if (!senderKey) {
            return res.status(400).json({ success: false, error: "senderKey는 필수입니다." });
        }

        // 설정 존재 여부 확인
        const [existing] = await db
            .select({ id: alimtalkConfigs.id })
            .from(alimtalkConfigs)
            .where(eq(alimtalkConfigs.orgId, user.orgId))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ success: false, error: "알림톡 설정이 없습니다." });
        }

        await db
            .update(alimtalkConfigs)
            .set({ defaultSenderKey: senderKey, updatedAt: new Date() })
            .where(eq(alimtalkConfigs.orgId, user.orgId));

        return res.status(200).json({
            success: true,
            message: "기본 발신프로필이 설정되었습니다.",
        });
    } catch (error) {
        console.error("Default sender update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
