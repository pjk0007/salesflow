import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, users, organizationMembers } from "@/lib/db";
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
        ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
        : undefined;

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where);

    const userList = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            isActive: users.isActive,
            isSuperAdmin: users.isSuperAdmin,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(where)
        .orderBy(users.createdAt)
        .limit(limit)
        .offset(offset);

    const rows = await Promise.all(
        userList.map(async (u) => {
            const [mc] = await db
                .select({ count: count() })
                .from(organizationMembers)
                .where(eq(organizationMembers.userId, u.id));
            return { ...u, orgCount: mc?.count ?? 0 };
        })
    );

    return NextResponse.json({
        success: true,
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
}
