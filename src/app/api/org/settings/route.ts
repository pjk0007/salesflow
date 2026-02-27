import { NextRequest, NextResponse } from "next/server";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest, generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload } from "@/types";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const [org] = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            })
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!org) {
            return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: org });
    } catch (error) {
        console.error("Org settings fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const { name, branding, settings, integratedCodePrefix } = await req.json();

        if (name !== undefined && !name.trim()) {
            return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
        }

        // 기존 데이터 조회
        const [existing] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!existing) {
            return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
        }

        // 업데이트할 필드 구성
        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }

        if (branding !== undefined) {
            updateData.branding = { ...existing.branding, ...branding };
        }

        if (settings !== undefined) {
            updateData.settings = { ...existing.settings, ...settings };
        }

        if (integratedCodePrefix !== undefined && integratedCodePrefix.trim()) {
            updateData.integratedCodePrefix = integratedCodePrefix.trim();
        }

        const [updated] = await db
            .update(organizations)
            .set(updateData)
            .where(eq(organizations.id, user.orgId))
            .returning({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Org settings update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role !== "owner") {
        return NextResponse.json({ success: false, error: "조직 삭제는 소유자만 가능합니다." }, { status: 403 });
    }

    try {
        // 사용자의 다른 조직 찾기
        const otherOrgs = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.userId, user.userId),
                    // 현재 삭제할 조직 제외 — 삭제 전에 먼저 조회
                )
            );

        const nextOrg = otherOrgs.find((o) => o.organizationId !== user.orgId);

        // 조직 삭제
        await db.delete(organizations).where(eq(organizations.id, user.orgId));

        if (nextOrg) {
            // 다른 조직으로 JWT 전환
            const payload: JWTPayload = {
                userId: user.userId,
                email: user.email,
                name: user.name,
                orgId: nextOrg.organizationId,
                role: nextOrg.role as "owner" | "admin" | "member",
            };
            const token = generateToken(payload);
            const maxAge = Math.floor(getTokenExpiryMs() / 1000);
            const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
            const cookieString = `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
            const response = NextResponse.json({ success: true, switchedTo: nextOrg.organizationId });
            response.headers.set("Set-Cookie", cookieString);
            return response;
        } else {
            // 다른 조직 없음 — 쿠키 삭제
            const cookieString = "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
            const response = NextResponse.json({ success: true, noOrgsLeft: true });
            response.headers.set("Set-Cookie", cookieString);
            return response;
        }
    } catch (error) {
        console.error("Org delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
