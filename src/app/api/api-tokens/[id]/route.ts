import { NextRequest, NextResponse } from "next/server";
import { db, apiTokens, apiTokenScopes } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const tokenId = Number(id);
    if (!tokenId) {
        return NextResponse.json({ success: false, error: "토큰 ID가 필요합니다." }, { status: 400 });
    }

    try {
        // 소유권 확인
        const [existing] = await db
            .select()
            .from(apiTokens)
            .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "토큰을 찾을 수 없습니다." }, { status: 404 });
        }

        const { name, isActive, scopes } = await req.json();

        await db.transaction(async (tx) => {
            const updates: Record<string, unknown> = {};
            if (name !== undefined) updates.name = name;
            if (isActive !== undefined) updates.isActive = isActive;

            if (Object.keys(updates).length > 0) {
                await tx
                    .update(apiTokens)
                    .set(updates)
                    .where(eq(apiTokens.id, tokenId));
            }

            if (scopes && Array.isArray(scopes)) {
                await tx.delete(apiTokenScopes).where(eq(apiTokenScopes.tokenId, tokenId));
                for (const scope of scopes) {
                    await tx.insert(apiTokenScopes).values({
                        tokenId,
                        scopeType: scope.scopeType,
                        scopeId: scope.scopeId,
                        permissions: scope.permissions,
                    });
                }
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("API token update error:", error);
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
    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const tokenId = Number(id);
    if (!tokenId) {
        return NextResponse.json({ success: false, error: "토큰 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: apiTokens.id })
            .from(apiTokens)
            .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "토큰을 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(apiTokens).where(eq(apiTokens.id, tokenId));

        return NextResponse.json({ success: true, message: "토큰이 삭제되었습니다." });
    } catch (error) {
        console.error("API token delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
