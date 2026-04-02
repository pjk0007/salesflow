import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, users } from "@/lib/db";
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
        ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
        : undefined;

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where);

    const rows = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            isActive: users.isActive,
            isSuperAdmin: users.isSuperAdmin,
            createdAt: users.createdAt,
            orgCount: sql<number>`(SELECT count(*)::int FROM organization_members WHERE user_id = ${users.id})`,
        })
        .from(users)
        .where(where)
        .orderBy(users.createdAt)
        .limit(limit)
        .offset(offset);

    return NextResponse.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
