import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const startDate = req.nextUrl.searchParams.get("startDate");
        const endDate = req.nextUrl.searchParams.get("endDate");
        const channel = req.nextUrl.searchParams.get("channel") || "all";

        if (!startDate || !endDate) {
            return NextResponse.json({ success: false, error: "startDate, endDate는 필수입니다." }, { status: 400 });
        }

        const { orgId } = user;
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // 알림톡 일별 집계
        const alimtalkTrends = channel === "email" ? [] :
            await db
                .select({
                    date: sql<string>`date_trunc('day', ${alimtalkSendLogs.sentAt})::date::text`.as("date"),
                    sent: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} = 'sent')::int`.as("sent"),
                    failed: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
                })
                .from(alimtalkSendLogs)
                .where(and(
                    eq(alimtalkSendLogs.orgId, orgId),
                    gte(alimtalkSendLogs.sentAt, start),
                    lte(alimtalkSendLogs.sentAt, end),
                ))
                .groupBy(sql`date_trunc('day', ${alimtalkSendLogs.sentAt})`)
                .orderBy(sql`date_trunc('day', ${alimtalkSendLogs.sentAt})`);

        // 이메일 일별 집계
        const emailTrends = channel === "alimtalk" ? [] :
            await db
                .select({
                    date: sql<string>`date_trunc('day', ${emailSendLogs.sentAt})::date::text`.as("date"),
                    sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`.as("sent"),
                    failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
                })
                .from(emailSendLogs)
                .where(and(
                    eq(emailSendLogs.orgId, orgId),
                    gte(emailSendLogs.sentAt, start),
                    lte(emailSendLogs.sentAt, end),
                ))
                .groupBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`)
                .orderBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`);

        // Map으로 날짜별 합산
        const map = new Map<string, {
            date: string;
            alimtalkSent: number;
            alimtalkFailed: number;
            emailSent: number;
            emailFailed: number;
        }>();

        for (const row of alimtalkTrends) {
            map.set(row.date, {
                date: row.date,
                alimtalkSent: row.sent,
                alimtalkFailed: row.failed,
                emailSent: 0,
                emailFailed: 0,
            });
        }

        for (const row of emailTrends) {
            const existing = map.get(row.date);
            if (existing) {
                existing.emailSent = row.sent;
                existing.emailFailed = row.failed;
            } else {
                map.set(row.date, {
                    date: row.date,
                    alimtalkSent: 0,
                    alimtalkFailed: 0,
                    emailSent: row.sent,
                    emailFailed: row.failed,
                });
            }
        }

        const data = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Analytics trends error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
