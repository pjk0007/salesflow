import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers, subscriptions, plans } from "@/lib/db";
import { sql, eq, ilike, or } from "drizzle-orm";

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

    const rows = await db
        .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            createdAt: organizations.createdAt,
            memberCount: sql<number>`(SELECT count(*)::int FROM organization_members WHERE organization_id = ${organizations.id})`,
            planName: sql<string>`(
                SELECT p.name FROM subscriptions s
                JOIN plans p ON p.id = s.plan_id
                WHERE s.organization_id = ${organizations.id} AND s.status = 'active'
                LIMIT 1
            )`,
        })
        .from(organizations)
        .where(where)
        .orderBy(organizations.createdAt)
        .limit(limit)
        .offset(offset);

    return NextResponse.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
