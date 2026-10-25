import { NextRequest, NextResponse } from "next/server";
import { db, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest, setSessionCookie } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";

export async function POST(req: NextRequest) {
    try {
        const user = await getActiveUserFromNextRequest(req, { scope: "account" });
        if (!user) {
            return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ success: false, error: "요청 본문을 확인해주세요." }, { status: 400 });
        }
        const { orgId } = body;
        if (!orgId || typeof orgId !== "string") {
            return NextResponse.json({ success: false, error: "조직 ID가 필요합니다." }, { status: 400 });
        }

        // 소속 확인
        const [membership] = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
                tokenVersion: organizationMembers.tokenVersion,
            })
            .from(organizationMembers)
            .where(and(
                eq(organizationMembers.userId, user.userId),
                eq(organizationMembers.organizationId, orgId)
            ));

        if (!membership) {
            return NextResponse.json({
                success: false,
                error: "해당 조직에 소속되어 있지 않습니다.",
            }, { status: 403 });
        }

        // JWT 재발급
        const payload: JWTPayload = {
            userId: user.userId,
            orgId: membership.organizationId,
            email: user.email,
            name: user.name,
            role: membership.role as OrgRole,
            // 전환 대상 조직의 버전을 담는다 — 조직마다 무효화가 독립적이다
            tokenVersion: membership.tokenVersion,
            // 슈퍼관리자 표시는 DB 값(user)을 그대로 이어 간다 — 전환 뒤 /admin 메뉴가 사라지지 않는다
            ...(user.isSuperAdmin && { isSuperAdmin: true }),
        };

        const response = NextResponse.json({ success: true, user: payload });
        await setSessionCookie(response, payload);
        return response;
    } catch (error) {
        console.error("Org switch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
