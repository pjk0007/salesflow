import { NextRequest, NextResponse } from "next/server";
import { db, memberScopes } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { validateMemberScopes, type MemberScopeInput } from "@/lib/partition-access";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const scopeId = Number(id);
    if (!scopeId) {
        return NextResponse.json({ success: false, error: "권한 ID가 필요합니다." }, { status: 400 });
    }

    try {
        // 다른 조직의 행을 수정할 수 없다
        const [existing] = await db
            .select()
            .from(memberScopes)
            .where(and(eq(memberScopes.id, scopeId), eq(memberScopes.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "권한을 찾을 수 없습니다." }, { status: 404 });
        }

        const body = await req.json();

        // 부여(POST)와 같은 검증을 통과시킨다 — 수정 경로로 org 경계를 우회할 수 없게
        const candidate: MemberScopeInput = {
            scopeType: typeof body?.scopeType === "string" ? body.scopeType : existing.scopeType,
            scopeId: typeof body?.scopeId === "number" ? body.scopeId : existing.scopeId,
            permissions: body?.permissions ?? existing.permissions,
        };

        const validated = await validateMemberScopes([candidate], user.orgId);
        if (!validated.ok) {
            return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
        }

        const next = validated.scopes[0];
        const [updated] = await db
            .update(memberScopes)
            .set({
                scopeType: next.scopeType,
                scopeId: next.scopeId,
                permissions: next.permissions,
                updatedAt: new Date(),
            })
            .where(eq(memberScopes.id, scopeId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Member scope update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const scopeId = Number(id);
    if (!scopeId) {
        return NextResponse.json({ success: false, error: "권한 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const deleted = await db
            .delete(memberScopes)
            .where(and(eq(memberScopes.id, scopeId), eq(memberScopes.orgId, user.orgId)))
            .returning({ id: memberScopes.id });

        if (deleted.length === 0) {
            return NextResponse.json({ success: false, error: "권한을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Member scope delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
