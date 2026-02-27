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
        const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 10, 50);

        if (!startDate || !endDate) {
            return NextResponse.json({ success: false, error: "startDate, endDate는 필수입니다." }, { status: 400 });
        }

        const { orgId } = user;
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // 알림톡 템플릿 집계
        const alimtalkTemplates = channel === "email" ? [] :
            await db
                .select({
                    name: alimtalkSendLogs.templateName,
                    total: sql<number>`count(*)::int`.as("total"),
                    sent: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} = 'sent')::int`.as("sent"),
                    failed: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
                })
                .from(alimtalkSendLogs)
                .where(and(
                    eq(alimtalkSendLogs.orgId, orgId),
                    gte(alimtalkSendLogs.sentAt, start),
                    lte(alimtalkSendLogs.sentAt, end),
                ))
                .groupBy(alimtalkSendLogs.templateName)
                .orderBy(sql`count(*) desc`)
                .limit(limit);

        // 이메일 템플릿(제목) 집계
        const emailTemplates = channel === "alimtalk" ? [] :
            await db
                .select({
                    name: emailSendLogs.subject,
                    total: sql<number>`count(*)::int`.as("total"),
                    sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`.as("sent"),
                    failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
                })
                .from(emailSendLogs)
                .where(and(
                    eq(emailSendLogs.orgId, orgId),
                    gte(emailSendLogs.sentAt, start),
                    lte(emailSendLogs.sentAt, end),
                ))
                .groupBy(emailSendLogs.subject)
                .orderBy(sql`count(*) desc`)
                .limit(limit);

        // 합산 + 정렬
        const combined = [
            ...alimtalkTemplates.map(t => ({
                name: t.name || "(이름 없음)",
                channel: "alimtalk" as const,
                total: t.total,
                sent: t.sent,
                failed: t.failed,
                successRate: t.total > 0 ? Math.round((t.sent / t.total) * 100) : 0,
            })),
            ...emailTemplates.map(t => ({
                name: t.name || "(제목 없음)",
                channel: "email" as const,
                total: t.total,
                sent: t.sent,
                failed: t.failed,
                successRate: t.total > 0 ? Math.round((t.sent / t.total) * 100) : 0,
            })),
        ]
            .sort((a, b) => b.total - a.total)
            .slice(0, limit);

        return NextResponse.json({ success: true, data: combined });
    } catch (error) {
        console.error("Analytics templates error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
