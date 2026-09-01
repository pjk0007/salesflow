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
    const user = auth.user;

    const { id: targetId } = await params;

    try {
        const { role } = await req.json();
        if (!role || !["admin", "member"].includes(role)) {
            return NextResponse.json({ success: false, error: "유효하지 않은 역할입니다." }, { status: 400 });
        }

        if (user.userId === targetId) {
            return NextResponse.json({ success: false, error: "자신의 역할은 변경할 수 없습니다." }, { status: 403 });
        }

        // organizationMembers에서 대상 조회
        const [target] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, user.orgId)
            ));

        if (!target) {
            return NextResponse.json({ success: false, error: "멤버를 찾을 수 없습니다." }, { status: 404 });
        }

        if (target.role === "owner") {
            return NextResponse.json({ success: false, error: "소유자의 역할은 변경할 수 없습니다." }, { status: 403 });
        }

        // admin은 admin 승격 불가
        if (user.role === "admin" && role === "admin") {
            return NextResponse.json({ success: false, error: "관리자 승격 권한이 없습니다." }, { status: 403 });
        }

        // admin은 다른 admin 변경 불가
        if (user.role === "admin" && target.role === "admin") {
            return NextResponse.json({ success: false, error: "관리자의 역할을 변경할 수 없습니다." }, { status: 403 });
        }

        // organizationMembers에서 role 업데이트
        // role과 token_version을 같은 UPDATE에서 바꾼다. 문장을 나누면 사이에서 실패했을 때
        // role만 강등되고 옛 토큰이 살아남는 창이 생긴다.
        // sql`+1`을 쓰는 이유: read-modify-write는 동시 변경 시 증가가 유실될 수 있다.
        await db
            .update(organizationMembers)
            .set({ role, tokenVersion: sql`${organizationMembers.tokenVersion} + 1` })
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, user.orgId)
            ));

        return NextResponse.json({ success: true, data: { id: targetId, role } });
    } catch (error) {
        console.error("Member role update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    const { id: targetId } = await params;

    try {
        if (user.userId === targetId) {
            return NextResponse.json({ success: false, error: "자기 자신을 제거할 수 없습니다." }, { status: 403 });
        }

        // organizationMembers에서 대상 조회
        const [target] = await db
            .select({
                id: users.id,
                role: organizationMembers.role,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, user.orgId)
            ));

        if (!target) {
            return NextResponse.json({ success: false, error: "멤버를 찾을 수 없습니다." }, { status: 404 });
        }

        if (target.role === "owner") {
            return NextResponse.json({ success: false, error: "소유자는 제거할 수 없습니다." }, { status: 403 });
        }

        // admin은 다른 admin 제거 불가
        if (user.role === "admin" && target.role === "admin") {
            return NextResponse.json({ success: false, error: "관리자를 제거할 권한이 없습니다." }, { status: 403 });
        }

        // organizationMembers에서 제거
        await db
            .delete(organizationMembers)
            .where(and(
                eq(organizationMembers.userId, targetId),
                eq(organizationMembers.organizationId, user.orgId)
            ));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Member remove error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
