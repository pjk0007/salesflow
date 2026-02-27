import { NextRequest, NextResponse } from "next/server";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { verifyPassword, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export async function POST(req: NextRequest) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json(
                { success: false, error: "이메일과 비밀번호를 입력해주세요." },
                { status: 400 }
            );
        }

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.trim().toLowerCase()));

        if (!user) {
            return NextResponse.json(
                { success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." },
                { status: 401 }
            );
        }

        if (user.password === "ADION_SSO") {
            return NextResponse.json(
                { success: false, error: "비밀번호 재설정이 필요합니다. 관리자에게 문의해주세요." },
                { status: 401 }
            );
        }

        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
            return NextResponse.json(
                { success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." },
                { status: 401 }
            );
        }

        if (user.isActive !== 1) {
            return NextResponse.json(
                { success: false, error: "비활성 계정입니다." },
                { status: 403 }
            );
        }

        // organizationMembers에서 소속 조직 조회
        const memberships = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
                joinedAt: organizationMembers.joinedAt,
            })
            .from(organizationMembers)
            .where(eq(organizationMembers.userId, user.id))
            .orderBy(desc(organizationMembers.joinedAt));

        if (memberships.length === 0) {
            return NextResponse.json(
                { success: false, error: "소속된 조직이 없습니다." },
                { status: 403 }
            );
        }

        // users.orgId가 있으면 해당 조직 우선, 없으면 가장 최근 조직
        const selectedOrg = user.orgId
            ? memberships.find(m => m.organizationId === user.orgId) ?? memberships[0]
            : memberships[0];

        const payload: JWTPayload = {
            userId: user.id,
            orgId: selectedOrg.organizationId,
            email: user.email,
            name: user.name,
            role: selectedOrg.role as "owner" | "admin" | "member",
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);

        const response = NextResponse.json({ success: true, user: payload });
        response.cookies.set("token", token, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            maxAge,
            secure: process.env.NODE_ENV === "production",
        });

        return response;
    } catch (error) {
        console.error("Login error:", error);
        return NextResponse.json(
            { success: false, error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
