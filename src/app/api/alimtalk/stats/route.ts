import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const period = req.nextUrl.searchParams.get("period") || "today";
        const now = new Date();
        let since: Date;

        switch (period) {
            case "week":
                since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case "month":
                since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default: // today
                since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
        }

        const conditions = [
            eq(alimtalkSendLogs.orgId, user.orgId),
            gte(alimtalkSendLogs.sentAt, since),
        ];

        const where = and(...conditions);

        // 상태별 카운트
        const statusCounts = await db
            .select({
                status: alimtalkSendLogs.status,
                count: sql<number>`count(*)::int`,
            })
            .from(alimtalkSendLogs)
            .where(where)
            .groupBy(alimtalkSendLogs.status);

        let total = 0;
        let sent = 0;
        let failed = 0;
        let pending = 0;

        for (const row of statusCounts) {
            total += row.count;
            if (row.status === "sent") sent = row.count;
            else if (row.status === "failed") failed = row.count;
            else if (row.status === "pending") pending = row.count;
        }

        // 최근 10건
        const recentLogs = await db
            .select()
            .from(alimtalkSendLogs)
            .where(eq(alimtalkSendLogs.orgId, user.orgId))
            .orderBy(sql`${alimtalkSendLogs.sentAt} DESC`)
            .limit(10);

        return NextResponse.json({
            success: true,
            data: { total, sent, failed, pending, recentLogs },
        });
    } catch (error) {
        console.error("Alimtalk stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
