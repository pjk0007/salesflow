import { NextRequest, NextResponse } from "next/server";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, asc, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const members = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: organizationMembers.role,
                phone: users.phone,
                isActive: users.isActive,
                createdAt: users.createdAt,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(eq(organizationMembers.organizationId, user.orgId))
            .orderBy(desc(organizationMembers.role), asc(users.createdAt));

        return NextResponse.json({ success: true, data: members });
    } catch (error) {
        console.error("Members fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
