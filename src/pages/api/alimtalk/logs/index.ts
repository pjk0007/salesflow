import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
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
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
        const offset = (page - 1) * pageSize;

        const conditions = [eq(alimtalkSendLogs.orgId, user.orgId)];

        if (req.query.partitionId) {
            conditions.push(eq(alimtalkSendLogs.partitionId, Number(req.query.partitionId)));
        }
        if (req.query.templateLinkId) {
            conditions.push(eq(alimtalkSendLogs.templateLinkId, Number(req.query.templateLinkId)));
        }
        if (req.query.status) {
            conditions.push(eq(alimtalkSendLogs.status, req.query.status as string));
        }
        if (req.query.startDate) {
            conditions.push(gte(alimtalkSendLogs.sentAt, new Date(req.query.startDate as string)));
        }
        if (req.query.endDate) {
            const endDate = new Date(req.query.endDate as string);
            endDate.setHours(23, 59, 59, 999);
            conditions.push(lte(alimtalkSendLogs.sentAt, endDate));
        }

        const where = and(...conditions);

        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(alimtalkSendLogs)
            .where(where);

        const total = countResult.count;

        const logs = await db
            .select()
            .from(alimtalkSendLogs)
            .where(where)
            .orderBy(sql`${alimtalkSendLogs.sentAt} DESC`)
            .limit(pageSize)
            .offset(offset);

        return res.status(200).json({
            success: true,
            data: logs,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Alimtalk logs error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
