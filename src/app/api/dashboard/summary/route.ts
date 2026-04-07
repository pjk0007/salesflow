import { NextRequest, NextResponse } from "next/server";
import {
    db,
    records,
    workspaces,
    partitions,
    alimtalkSendLogs,
    emailSendLogs,
} from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { orgId } = user;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [
            recordCountResult,
            workspaceCountResult,
            partitionCountResult,
            alimtalkStats,
            emailStats,
            recentAlimtalk,
            recentEmail,
        ] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` })
                .from(records)
                .where(eq(records.orgId, orgId)),

            db.select({ count: sql<number>`count(*)::int` })
                .from(workspaces)
                .where(eq(workspaces.orgId, orgId)),

            db.select({ count: sql<number>`count(*)::int` })
                .from(partitions)
                .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                .where(eq(workspaces.orgId, orgId)),

            db.select({
                status: alimtalkSendLogs.status,
                count: sql<number>`count(*)::int`,
            })
                .from(alimtalkSendLogs)
                .where(and(
                    eq(alimtalkSendLogs.orgId, orgId),
                    gte(alimtalkSendLogs.sentAt, todayStart),
                ))
                .groupBy(alimtalkSendLogs.status),

            db.select({
                status: emailSendLogs.status,
                count: sql<number>`count(*)::int`,
            })
                .from(emailSendLogs)
                .where(and(
                    eq(emailSendLogs.orgId, orgId),
                    gte(emailSendLogs.sentAt, todayStart),
                ))
                .groupBy(emailSendLogs.status),

            db.select({
                id: alimtalkSendLogs.id,
                recipientNo: alimtalkSendLogs.recipientNo,
                templateName: alimtalkSendLogs.templateName,
                status: alimtalkSendLogs.status,
                sentAt: alimtalkSendLogs.sentAt,
            })
                .from(alimtalkSendLogs)
                .where(eq(alimtalkSendLogs.orgId, orgId))
                .orderBy(sql`${alimtalkSendLogs.sentAt} DESC`)
                .limit(5),

            db.select({
                id: emailSendLogs.id,
                recipientEmail: emailSendLogs.recipientEmail,
                subject: emailSendLogs.subject,
                status: emailSendLogs.status,
                sentAt: emailSendLogs.sentAt,
            })
                .from(emailSendLogs)
                .where(eq(emailSendLogs.orgId, orgId))
                .orderBy(sql`${emailSendLogs.sentAt} DESC`)
                .limit(5),
        ]);

        let alimtalkTotal = 0, alimtalkSent = 0, alimtalkFailed = 0, alimtalkPending = 0;
        for (const row of alimtalkStats) {
            alimtalkTotal += row.count;
            if (row.status === "sent") alimtalkSent = row.count;
            else if (row.status === "failed") alimtalkFailed = row.count;
            else if (row.status === "pending") alimtalkPending = row.count;
        }

        let emailTotal = 0, emailSent = 0, emailFailed = 0, emailPending = 0;
        for (const row of emailStats) {
            emailTotal += row.count;
            if (row.status === "sent") emailSent = row.count;
            else if (row.status === "failed" || row.status === "rejected") emailFailed += row.count;
            else if (row.status === "pending") emailPending = row.count;
        }

        return NextResponse.json({
            success: true,
            data: {
                recordCount: recordCountResult[0]?.count ?? 0,
                workspaceCount: workspaceCountResult[0]?.count ?? 0,
                partitionCount: partitionCountResult[0]?.count ?? 0,
                alimtalk: {
                    total: alimtalkTotal,
                    sent: alimtalkSent,
                    failed: alimtalkFailed,
                    pending: alimtalkPending,
                },
                email: {
                    total: emailTotal,
                    sent: emailSent,
                    failed: emailFailed,
                    pending: emailPending,
                },
                recentAlimtalkLogs: recentAlimtalk,
                recentEmailLogs: recentEmail,
            },
        });
    } catch (error) {
        console.error("Dashboard summary error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
