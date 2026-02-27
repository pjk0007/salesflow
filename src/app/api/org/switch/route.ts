import { NextRequest, NextResponse } from "next/server";
import { db, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { orgId } = await req.json();
    if (!orgId || typeof orgId !== "string") {
        return NextResponse.json({ success: false, error: "조직 ID가 필요합니다." }, { status: 400 });
    }

    try {
        // 소속 확인
        const [membership] = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
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
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const cookieString = `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

        const response = NextResponse.json({ success: true, user: payload });
        response.headers.set("Set-Cookie", cookieString);
        return response;
    } catch (error) {
        console.error("Org switch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
