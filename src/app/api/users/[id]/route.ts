import { NextRequest, NextResponse } from "next/server";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const currentUser = auth.user;

    const { id: targetId } = await params;
    if (!targetId) {
        return NextResponse.json({ success: false, error: "유효하지 않은 사용자 ID입니다." }, { status: 400 });
    }

    try {
        // 대상 사용자 조회 (organizationMembers 기반)
        const [targetUser] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
                isActive: users.isActive,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, currentUser.orgId)
            ));

        if (!targetUser) {
            return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
        }

        const { name, phone, role, isActive } = await req.json();
        const isSelf = currentUser.userId === targetId;

        // 본인 역할 변경 불가
        if (isSelf && role !== undefined && role !== targetUser.role) {
            return NextResponse.json({
                success: false,
                error: "본인의 역할은 변경할 수 없습니다.",
            }, { status: 403 });
        }

        // 본인 비활성화 불가
        if (isSelf && isActive !== undefined && isActive === 0) {
            return NextResponse.json({
                success: false,
                error: "본인 계정은 비활성화할 수 없습니다.",
            }, { status: 403 });
        }

        // admin은 member만 수정 가능
        if (currentUser.role === "admin" && targetUser.role !== "member" && !isSelf) {
            return NextResponse.json({
                success: false,
                error: "해당 사용자를 수정할 권한이 없습니다.",
            }, { status: 403 });
        }

        // admin이 member가 아닌 역할로 변경 시도
        if (currentUser.role === "admin" && role && role !== "member") {
            return NextResponse.json({
                success: false,
                error: "admin은 member 역할만 부여할 수 있습니다.",
            }, { status: 403 });
        }

        // 역할 유효성 검증
        if (role && !["owner", "admin", "member"].includes(role)) {
            return NextResponse.json({
                success: false,
                error: "유효하지 않은 역할입니다.",
            }, { status: 400 });
        }

        // users 테이블 업데이트 (name, phone, isActive)
        const userUpdateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };
        if (name !== undefined) userUpdateData.name = name;
        if (phone !== undefined) userUpdateData.phone = phone || null;
        if (isActive !== undefined) userUpdateData.isActive = isActive;

        const [updated] = await db
            .update(users)
            .set(userUpdateData)
            .where(eq(users.id, targetId))
            .returning({
                id: users.id,
                name: users.name,
                email: users.email,
                phone: users.phone,
                isActive: users.isActive,
                updatedAt: users.updatedAt,
            });

        // role 변경은 organizationMembers에서
        let finalRole = targetUser.role;
        if (role !== undefined) {
            // org/members/[id]와 같은 이유로 token_version을 같은 UPDATE에서 올린다 —
            // 여기서 빠지면 이 경로로 강등할 때 옛 토큰이 그대로 살아남는다.
            await db
                .update(organizationMembers)
                .set({ role, tokenVersion: sql`${organizationMembers.tokenVersion} + 1` })
                .where(and(
                    eq(organizationMembers.userId, targetId),
                    eq(organizationMembers.organizationId, currentUser.orgId)
                ));
            finalRole = role;
        }

        return NextResponse.json({
            success: true,
            data: { ...updated, role: finalRole },
        });
    } catch (error) {
        console.error("User update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
