import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers, subscriptions, plans } from "@/lib/db";
import { sql, eq, ilike, or, count } from "drizzle-orm";

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

            return {
                ...org,
                memberCount: mc?.count ?? 0,
                planName: sub?.planName ?? null,
            };
        })
    );

    return NextResponse.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
