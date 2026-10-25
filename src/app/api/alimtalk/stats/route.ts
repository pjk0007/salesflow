import { kstRecentDaysStart } from "@/lib/kst";
import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const period = req.nextUrl.searchParams.get("period") || "today";
        // week·month는 화면 표기대로 오늘(KST) 포함 최근 7일·30일, today는 KST 오늘 00:00부터
        const days = period === "week" ? 7 : period === "month" ? 30 : 1;
        const since = kstRecentDaysStart(new Date(), days);

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
        let unknown = 0;

        for (const row of statusCounts) {
            total += row.count;
            if (row.status === "sent") sent = row.count;
            else if (row.status === "failed") failed = row.count;
            else if (row.status === "pending") pending = row.count;
            else if (row.status === "unknown") unknown = row.count;
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
            data: { total, sent, failed, pending, unknown, recentLogs },
        });
    } catch (error) {
        console.error("Alimtalk stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
