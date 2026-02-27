import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

function aggregateStats(rows: Array<{ status: string; count: number }>) {
    let total = 0, sent = 0, failed = 0, pending = 0;
    for (const row of rows) {
        total += row.count;
        if (row.status === "sent") sent = row.count;
        else if (row.status === "failed" || row.status === "rejected") failed += row.count;
        else if (row.status === "pending") pending = row.count;
    }
    return { total, sent, failed, pending };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const { startDate, endDate } = req.query as {
            startDate?: string;
            endDate?: string;
        };

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: "startDate, endDate는 필수입니다." });
        }

        const { orgId } = user;
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const [alimtalkStats, emailStats, newRecordsCount] = await Promise.all([
            // 알림톡 상태별 카운트
            db.select({
                status: alimtalkSendLogs.status,
                count: sql<number>`count(*)::int`,
            })
                .from(alimtalkSendLogs)
                .where(and(
                    eq(alimtalkSendLogs.orgId, orgId),
                    gte(alimtalkSendLogs.sentAt, start),
                    lte(alimtalkSendLogs.sentAt, end),
                ))
                .groupBy(alimtalkSendLogs.status),

            // 이메일 상태별 카운트
            db.select({
                status: emailSendLogs.status,
                count: sql<number>`count(*)::int`,
            })
                .from(emailSendLogs)
                .where(and(
                    eq(emailSendLogs.orgId, orgId),
                    gte(emailSendLogs.sentAt, start),
                    lte(emailSendLogs.sentAt, end),
                ))
                .groupBy(emailSendLogs.status),

            // 기간 내 신규 레코드 수
            db.select({ count: sql<number>`count(*)::int` })
                .from(records)
                .where(and(
                    eq(records.orgId, orgId),
                    gte(records.createdAt, start),
                    lte(records.createdAt, end),
                )),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                alimtalk: aggregateStats(alimtalkStats),
                email: aggregateStats(emailStats),
                newRecordsInPeriod: newRecordsCount[0]?.count ?? 0,
            },
        });
    } catch (error) {
        console.error("Analytics summary error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
