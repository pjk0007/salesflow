import { NextRequest, NextResponse } from "next/server";
import { db, emailAssets } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// 이름 수정
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const assetId = Number(id);
        const { name } = await req.json();

        if (!name || typeof name !== "string" || !name.trim()) {
            return NextResponse.json({ success: false, error: "이름은 필수입니다." }, { status: 400 });
        }

        const [updated] = await db
            .update(emailAssets)
            .set({ name: name.trim() })
            .where(and(eq(emailAssets.id, assetId), eq(emailAssets.orgId, user.orgId)))
            .returning();

        if (!updated) {
            return NextResponse.json({ success: false, error: "에셋을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Email asset update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

// 목록에서 제거. R2 파일은 남긴다(이미 발송된 메일의 이미지 보호).
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const assetId = Number(id);

        const [deleted] = await db
            .delete(emailAssets)
            .where(and(eq(emailAssets.id, assetId), eq(emailAssets.orgId, user.orgId)))
            .returning({ id: emailAssets.id });

        if (!deleted) {
            return NextResponse.json({ success: false, error: "에셋을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Email asset delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
