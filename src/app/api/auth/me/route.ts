import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { OrgRole } from "@/types";

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

    // role은 JWT가 아니라 DB의 현재 값을 쓴다. 그러지 않으면 강등된 뒤에도
    // UI에 관리자 메뉴가 남아 누를 때마다 401만 나고 사용자가 이유를 모른다.
    // myOrgs에 이미 들어 있으므로 추가 쿼리는 없다.
    const currentMembership = myOrgs.find((o) => o.organizationId === user.orgId);

    return NextResponse.json({
        success: true,
        user: {
            ...user,
            role: (currentMembership?.role ?? user.role) as OrgRole,
            isSuperAdmin: user.isSuperAdmin ?? false,
            onboardingCompleted: org?.onboardingCompleted ?? false,
            organizations: myOrgs,
        },
    });
}
