import { NextRequest, NextResponse } from "next/server";
import { db, organizationInvitations, organizationMembers } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getUserFromNextRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { token } = await req.json();
    if (!token || typeof token !== "string") {
        return NextResponse.json({ success: false, error: "초대 토큰이 필요합니다." }, { status: 400 });
    }

    try {
        // 초대 조회 (pending + 만료 전)
        const [invitation] = await db
            .select()
            .from(organizationInvitations)
            .where(and(
                eq(organizationInvitations.token, token),
                eq(organizationInvitations.status, "pending"),
                gt(organizationInvitations.expiresAt, new Date())
            ));

        if (!invitation) {
            return NextResponse.json({
                success: false,
                error: "유효하지 않거나 만료된 초대입니다.",
            }, { status: 404 });
        }

        // 이메일 일치 확인
        if (invitation.email !== user.email) {
            return NextResponse.json({
                success: false,
                error: "초대받은 이메일과 현재 계정 이메일이 일치하지 않습니다.",
            }, { status: 403 });
        }

        // 이미 소속 확인
        const [existingMember] = await db
            .select({ id: organizationMembers.id })
            .from(organizationMembers)
            .where(and(
                eq(organizationMembers.userId, user.userId),
                eq(organizationMembers.organizationId, invitation.orgId)
            ));

        if (existingMember) {
            // 이미 소속되어 있으면 초대만 수락 처리
            await db.update(organizationInvitations)
                .set({ status: "accepted" })
                .where(eq(organizationInvitations.id, invitation.id));

            return NextResponse.json({
                success: true,
                message: "이미 해당 조직에 소속되어 있습니다.",
            });
        }

        // organizationMembers에 추가
        await db.insert(organizationMembers).values({
            organizationId: invitation.orgId,
            userId: user.userId,
            role: invitation.role,
        });

        // 초대 상태 업데이트
        await db.update(organizationInvitations)
            .set({ status: "accepted" })
            .where(eq(organizationInvitations.id, invitation.id));

        // 새 조직으로 JWT 재발급 (자동 전환)
        const payload: JWTPayload = {
            userId: user.userId,
            orgId: invitation.orgId,
            email: user.email,
            name: user.name,
            role: invitation.role as OrgRole,
        };

        const newToken = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const cookieString = `token=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

        const response = NextResponse.json({
            success: true,
            user: payload,
            message: "초대를 수락하고 조직에 참여했습니다.",
        });
        response.headers.set("Set-Cookie", cookieString);
        return response;
    } catch (error) {
        console.error("Invite accept error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
