import { NextRequest, NextResponse } from "next/server";
import { db, records, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

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

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const startDate = req.nextUrl.searchParams.get("startDate");
        const endDate = req.nextUrl.searchParams.get("endDate");

        if (!startDate || !endDate) {
            return NextResponse.json({ success: false, error: "startDate, endDate는 필수입니다." }, { status: 400 });
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

        return NextResponse.json({
            success: true,
            data: {
                alimtalk: aggregateStats(alimtalkStats),
                email: aggregateStats(emailStats),
                newRecordsInPeriod: newRecordsCount[0]?.count ?? 0,
            },
        });
    } catch (error) {
        console.error("Analytics summary error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
