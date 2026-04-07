import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers, subscriptions, plans, records, emailSendLogs, alimtalkSendLogs, workspaces, partitions } from "@/lib/db";
import { sql, ilike, or } from "drizzle-orm";

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

    // 단일 쿼리로 모든 정보 조회
    const rows = await db.execute<{
        id: string;
        name: string;
        slug: string;
        created_at: string;
        member_count: number;
        plan_name: string | null;
        record_count: number;
        email_count: number;
        alimtalk_count: number;
        last_activity: string | null;
    }>(sql`
        SELECT
            o.id,
            o.name,
            o.slug,
            o.created_at,
            COALESCE((SELECT count(*)::int FROM ${organizationMembers} om WHERE om.organization_id = o.id), 0) as member_count,
            (SELECT p.name FROM ${subscriptions} s JOIN ${plans} p ON p.id = s.plan_id WHERE s.org_id = o.id LIMIT 1) as plan_name,
            COALESCE((SELECT count(*)::int FROM ${records} r JOIN ${partitions} pt ON pt.id = r.partition_id JOIN ${workspaces} w ON w.id = pt.workspace_id WHERE w.org_id = o.id), 0) as record_count,
            COALESCE((SELECT count(*)::int FROM ${emailSendLogs} e WHERE e.org_id = o.id), 0) as email_count,
            COALESCE((SELECT count(*)::int FROM ${alimtalkSendLogs} a WHERE a.org_id = o.id), 0) as alimtalk_count,
            GREATEST(
                (SELECT max(r.created_at) FROM ${records} r JOIN ${partitions} pt ON pt.id = r.partition_id JOIN ${workspaces} w ON w.id = pt.workspace_id WHERE w.org_id = o.id),
                (SELECT max(e.sent_at) FROM ${emailSendLogs} e WHERE e.org_id = o.id),
                (SELECT max(a.sent_at) FROM ${alimtalkSendLogs} a WHERE a.org_id = o.id)
            ) as last_activity
        FROM ${organizations} o
        ${search ? sql`WHERE o.name ILIKE ${"%" + search + "%"} OR o.slug ILIKE ${"%" + search + "%"}` : sql``}
        ORDER BY o.created_at
        LIMIT ${limit} OFFSET ${offset}
    `);

    const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        createdAt: r.created_at,
        memberCount: r.member_count,
        planName: r.plan_name,
        recordCount: r.record_count,
        emailCount: r.email_count,
        alimtalkCount: r.alimtalk_count,
        lastActivity: r.last_activity,
    }));

    return NextResponse.json({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
