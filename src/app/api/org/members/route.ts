import { NextRequest, NextResponse } from "next/server";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, asc, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

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
