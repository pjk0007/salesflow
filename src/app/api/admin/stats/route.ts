import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, users, organizations, subscriptions, plans } from "@/lib/db";
import { sql, eq, gte } from "drizzle-orm";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [orgCount] = await db.select({ count: sql<number>`count(*)::int` }).from(organizations);
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [activeUserCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.isActive, 1));
    const [newUsersMonth] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, thirtyDaysAgo));
    const [newUsersWeek] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, sevenDaysAgo));

    // 구독 현황
    const subStats = await db
        .select({
            planName: plans.name,
            count: sql<number>`count(*)::int`,
        })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(eq(subscriptions.status, "active"))
        .groupBy(plans.name);

    // 최근 가입 추이 (일별, 30일)
    const signupTrend = await db
        .select({
            date: sql<string>`date_trunc('day', ${users.createdAt})::date::text`.as("date"),
            count: sql<number>`count(*)::int`,
        })
        .from(users)
        .where(gte(users.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${users.createdAt})`)
        .orderBy(sql`date_trunc('day', ${users.createdAt})`);

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
        },
    });
}
