import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const logId = Number(req.query.id);
        if (!logId) {
            return res.status(400).json({ success: false, error: "유효하지 않은 ID입니다." });
        }

        const [log] = await db
            .select()
            .from(alimtalkSendLogs)
            .where(and(eq(alimtalkSendLogs.id, logId), eq(alimtalkSendLogs.orgId, user.orgId)))
            .limit(1);

        if (!log) {
            return res.status(404).json({ success: false, error: "발송 로그를 찾을 수 없습니다." });
        }

        return res.status(200).json({ success: true, data: log });
    } catch (error) {
        console.error("Alimtalk log detail error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
