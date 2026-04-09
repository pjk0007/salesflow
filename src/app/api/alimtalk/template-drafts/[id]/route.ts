import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkTemplateDrafts } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// 단건 조회
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const [draft] = await db
        .select()
        .from(alimtalkTemplateDrafts)
        .where(and(eq(alimtalkTemplateDrafts.id, Number(id)), eq(alimtalkTemplateDrafts.orgId, user.orgId)))
        .limit(1);

    if (!draft) {
        return NextResponse.json({ success: false, error: "임시저장을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: draft });
}

// 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    await db.delete(alimtalkTemplateDrafts)
        .where(and(eq(alimtalkTemplateDrafts.id, Number(id)), eq(alimtalkTemplateDrafts.orgId, user.orgId)));

    return NextResponse.json({ success: true, message: "삭제되었습니다." });
}
