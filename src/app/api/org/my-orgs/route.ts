import { NextRequest, NextResponse } from "next/server";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const orgs = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                role: organizationMembers.role,
                joinedAt: organizationMembers.joinedAt,
            })
            .from(organizationMembers)
            .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
            .where(eq(organizationMembers.userId, user.userId));

        return NextResponse.json({
            success: true,
            data: orgs,
            currentOrgId: user.orgId,
        });
    } catch (error) {
        console.error("My orgs error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
