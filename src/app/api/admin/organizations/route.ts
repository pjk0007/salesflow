import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers, subscriptions, plans, records, emailSendLogs, alimtalkSendLogs, workspaces, partitions } from "@/lib/db";
import { sql, eq, ilike, or, count, max } from "drizzle-orm";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 20)));
    const offset = (page - 1) * limit;

    const where = search
        ? or(ilike(organizations.name, `%${search}%`), ilike(organizations.slug, `%${search}%`))
        : undefined;

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(organizations)
        .where(where);

    const orgs = await db
        .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            createdAt: organizations.createdAt,
        })
        .from(organizations)
        .where(where)
        .orderBy(organizations.createdAt)
        .limit(limit)
        .offset(offset);

    // 각 조직의 멤버 수 + 플랜명 조회
    const rows = await Promise.all(
        orgs.map(async (org) => {
            const [mc] = await db
                .select({ count: count() })
                .from(organizationMembers)
                .where(eq(organizationMembers.organizationId, org.id));

            const [sub] = await db
                .select({ planName: plans.name })
                .from(subscriptions)
                .innerJoin(plans, eq(plans.id, subscriptions.planId))
                .where(eq(subscriptions.orgId, org.id))
                .limit(1);

            // 레코드 수
            const [rc] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(records)
                .innerJoin(partitions, eq(partitions.id, records.partitionId))
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(eq(workspaces.orgId, org.id));

            // 이메일 발송 수
            const [ec] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(emailSendLogs)
                .where(eq(emailSendLogs.orgId, org.id));

            // 알림톡 발송 수
            const [ac] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(alimtalkSendLogs)
                .where(eq(alimtalkSendLogs.orgId, org.id));

            // 마지막 활동 (레코드 생성/이메일/알림톡 중 최신)
            const [lastRecord] = await db
                .select({ at: max(records.createdAt) })
                .from(records)
                .innerJoin(partitions, eq(partitions.id, records.partitionId))
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(eq(workspaces.orgId, org.id));
            const [lastEmail] = await db
                .select({ at: max(emailSendLogs.sentAt) })
                .from(emailSendLogs)
                .where(eq(emailSendLogs.orgId, org.id));
            const [lastAlimtalk] = await db
                .select({ at: max(alimtalkSendLogs.sentAt) })
                .from(alimtalkSendLogs)
                .where(eq(alimtalkSendLogs.orgId, org.id));

            const dates = [lastRecord?.at, lastEmail?.at, lastAlimtalk?.at].filter(Boolean) as Date[];
            const lastActivity = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

            return {
                ...org,
                memberCount: mc?.count ?? 0,
                planName: sub?.planName ?? null,
                recordCount: rc?.count ?? 0,
                emailCount: ec?.count ?? 0,
                alimtalkCount: ac?.count ?? 0,
                lastActivity,
            };
        })
    );

    return NextResponse.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
