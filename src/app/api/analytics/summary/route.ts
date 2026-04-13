import { NextRequest, NextResponse } from "next/server";
import { db, records, alimtalkSendLogs, emailSendLogs, emailClickLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

function aggregateStats(rows: Array<{ status: string; count: number; opened: number }>, clicked: number) {
    let total = 0, sent = 0, failed = 0, pending = 0, opened = 0;
    for (const row of rows) {
        total += row.count;
        opened += row.opened;
        if (row.status === "sent") sent = row.count;
        else if (row.status === "failed" || row.status === "rejected") failed += row.count;
        else if (row.status === "pending") pending = row.count;
    }
    const openRate = sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0;
    const clickRate = opened > 0 ? Math.round((clicked / opened) * 1000) / 10 : 0;
    return { total, sent, failed, pending, opened, openRate, clicked, clickRate };
}

function aggregateAlimtalkStats(rows: Array<{ status: string; count: number }>) {
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

        const emailWhere = and(
            eq(emailSendLogs.orgId, orgId),
            gte(emailSendLogs.sentAt, start),
            lte(emailSendLogs.sentAt, end),
        );

        const [alimtalkStats, emailStats, newRecordsCount, triggerBreakdown, totalClicked] = await Promise.all([
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

            // 이메일 상태별 카운트 + 읽음
            db.select({
                status: emailSendLogs.status,
                count: sql<number>`count(*)::int`,
                opened: sql<number>`count(*) filter (where ${emailSendLogs.isOpened} = 1)::int`,
            })
                .from(emailSendLogs)
                .where(emailWhere)
                .groupBy(emailSendLogs.status),

            // 기간 내 신규 레코드 수
            db.select({ count: sql<number>`count(*)::int` })
                .from(records)
                .where(and(
                    eq(records.orgId, orgId),
                    gte(records.createdAt, start),
                    lte(records.createdAt, end),
                )),

            // triggerType별 breakdown (클릭 수 포함)
            db.select({
                triggerType: emailSendLogs.triggerType,
                total: sql<number>`count(*)::int`,
                sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`,
                failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`,
                opened: sql<number>`count(*) filter (where ${emailSendLogs.isOpened} = 1)::int`,
                clicked: sql<number>`count(*) filter (where exists (select 1 from ${emailClickLogs} where ${emailClickLogs.sendLogId} = ${emailSendLogs.id}))::int`,
            })
                .from(emailSendLogs)
                .where(emailWhere)
                .groupBy(emailSendLogs.triggerType),

            // 전체 클릭된 이메일 수 (읽음 대비 클릭률 계산용)
            db.select({
                count: sql<number>`count(distinct ${emailClickLogs.sendLogId})::int`,
            })
                .from(emailClickLogs)
                .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
                .where(emailWhere),
        ]);

        const triggerData = triggerBreakdown.map((t) => ({
            triggerType: t.triggerType || "unknown",
            total: t.total,
            sent: t.sent,
            failed: t.failed,
            opened: t.opened,
            clicked: t.clicked,
            successRate: t.total > 0 ? Math.round((t.sent / t.total) * 1000) / 10 : 0,
            openRate: t.sent > 0 ? Math.round((t.opened / t.sent) * 1000) / 10 : 0,
            clickRate: t.opened > 0 ? Math.round((t.clicked / t.opened) * 1000) / 10 : 0,
        }));

        return NextResponse.json({
            success: true,
            data: {
                alimtalk: aggregateAlimtalkStats(alimtalkStats),
                email: aggregateStats(emailStats, totalClicked[0]?.count ?? 0),
                newRecordsInPeriod: newRecordsCount[0]?.count ?? 0,
                triggerBreakdown: triggerData,
            },
        });
    } catch (error) {
        console.error("Analytics summary error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
