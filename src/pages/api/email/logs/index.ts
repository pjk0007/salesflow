import type { NextApiRequest, NextApiResponse } from "next";
import { db, emailSendLogs } from "@/lib/db";
import { eq, and, desc, sql } from "drizzle-orm";
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
        const page = Number(req.query.page) || 1;
        const pageSize = Math.min(Number(req.query.pageSize) || 50, 100);
        const offset = (page - 1) * pageSize;

        const conditions = [eq(emailSendLogs.orgId, user.orgId)];

        if (req.query.partitionId) {
            conditions.push(eq(emailSendLogs.partitionId, Number(req.query.partitionId)));
        }
        if (req.query.triggerType && typeof req.query.triggerType === "string") {
            conditions.push(eq(emailSendLogs.triggerType, req.query.triggerType));
        }

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailSendLogs)
            .where(and(...conditions));

        const logs = await db
            .select()
            .from(emailSendLogs)
            .where(and(...conditions))
            .orderBy(desc(emailSendLogs.sentAt))
            .limit(pageSize)
            .offset(offset);

        return res.status(200).json({
            success: true,
            data: logs,
            totalCount: Number(countResult.count),
        });
    } catch (error) {
        console.error("Email logs fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
