import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, users, organizations, subscriptions, plans, records, emailSendLogs, alimtalkSendLogs, aiUsageLogs, workspaces, partitions } from "@/lib/db";
import { sql, eq, gte } from "drizzle-orm";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
        [orgCount],
        [userCount],
        [activeUserCount],
        [newUsersMonth],
        [newUsersWeek],
        subStats,
        signupTrend,
        [recordCount],
        [emailCount],
        [alimtalkCount],
        [aiTokens],
        [workspaceCount],
        [partitionCount],
        [emailsMonth],
        [alimtalkMonth],
        [recordsMonth],
    ] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(organizations),
        db.select({ count: sql<number>`count(*)::int` }).from(users),
        db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.isActive, 1)),
        db.select({ count: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, thirtyDaysAgo)),
        db.select({ count: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, sevenDaysAgo)),
        db.select({ planName: plans.name, count: sql<number>`count(*)::int` })
            .from(subscriptions).innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.status, "active")).groupBy(plans.name),
        db.select({ date: sql<string>`date_trunc('day', ${users.createdAt})::date::text`.as("date"), count: sql<number>`count(*)::int` })
            .from(users).where(gte(users.createdAt, thirtyDaysAgo))
            .groupBy(sql`date_trunc('day', ${users.createdAt})`).orderBy(sql`date_trunc('day', ${users.createdAt})`),
        db.select({ count: sql<number>`count(*)::int` }).from(records),
        db.select({ count: sql<number>`count(*)::int` }).from(emailSendLogs),
        db.select({ count: sql<number>`count(*)::int` }).from(alimtalkSendLogs),
        db.select({ total: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens} + ${aiUsageLogs.completionTokens}), 0)::int` }).from(aiUsageLogs),
        db.select({ count: sql<number>`count(*)::int` }).from(workspaces),
        db.select({ count: sql<number>`count(*)::int` }).from(partitions),
        db.select({ count: sql<number>`count(*)::int` }).from(emailSendLogs).where(gte(emailSendLogs.sentAt, thirtyDaysAgo)),
        db.select({ count: sql<number>`count(*)::int` }).from(alimtalkSendLogs).where(gte(alimtalkSendLogs.sentAt, thirtyDaysAgo)),
        db.select({ count: sql<number>`count(*)::int` }).from(records).where(gte(records.createdAt, thirtyDaysAgo)),
    ]);

    return NextResponse.json({
        success: true,
        data: {
            totalOrganizations: orgCount.count,
            totalUsers: userCount.count,
            activeUsers: activeUserCount.count,
            newUsersMonth: newUsersMonth.count,
            newUsersWeek: newUsersWeek.count,
            subscriptionsByPlan: subStats,
            signupTrend,
            totalRecords: recordCount.count,
            totalWorkspaces: workspaceCount.count,
            totalPartitions: partitionCount.count,
            totalEmails: emailCount.count,
            totalAlimtalk: alimtalkCount.count,
            totalAiTokens: aiTokens.total,
            emailsMonth: emailsMonth.count,
            alimtalkMonth: alimtalkMonth.count,
            recordsMonth: recordsMonth.count,
        },
    });
}
