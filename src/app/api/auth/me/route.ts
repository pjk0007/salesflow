import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json(
            { success: false, error: "인증되지 않았습니다." },
            { status: 401 }
        );
    }

    const [org] = await db
        .select({ onboardingCompleted: organizations.onboardingCompleted })
        .from(organizations)
        .where(eq(organizations.id, user.orgId));

    // 소속 조직 목록
    const myOrgs = await db
        .select({
            organizationId: organizationMembers.organizationId,
            role: organizationMembers.role,
            orgName: organizations.name,
            orgSlug: organizations.slug,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, user.userId));

    return NextResponse.json({
        success: true,
        user: {
            ...user,
            onboardingCompleted: org?.onboardingCompleted ?? false,
            organizations: myOrgs,
        },
    });
}
