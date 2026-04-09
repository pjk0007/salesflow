import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkTemplateDrafts } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// 목록 조회
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const senderKey = req.nextUrl.searchParams.get("senderKey");
    const conditions = [eq(alimtalkTemplateDrafts.orgId, user.orgId)];
    if (senderKey) conditions.push(eq(alimtalkTemplateDrafts.senderKey, senderKey));

    const drafts = await db
        .select()
        .from(alimtalkTemplateDrafts)
        .where(and(...conditions))
        .orderBy(desc(alimtalkTemplateDrafts.updatedAt));

    return NextResponse.json({ success: true, data: drafts });
}

// 생성 / 업데이트 (upsert by orgId + senderKey + templateCode)
export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { senderKey, templateCode, templateName, formData } = await req.json();
    if (!senderKey || !templateCode || !templateName || !formData) {
        return NextResponse.json({ success: false, error: "필수 필드가 누락되었습니다." }, { status: 400 });
    }

    // 기존 임시저장이 있는지 확인
    const [existing] = await db
        .select({ id: alimtalkTemplateDrafts.id })
        .from(alimtalkTemplateDrafts)
        .where(and(
            eq(alimtalkTemplateDrafts.orgId, user.orgId),
            eq(alimtalkTemplateDrafts.senderKey, senderKey),
            eq(alimtalkTemplateDrafts.templateCode, templateCode),
        ))
        .limit(1);

    if (existing) {
        await db.update(alimtalkTemplateDrafts)
            .set({ templateName, formData, updatedAt: new Date() })
            .where(eq(alimtalkTemplateDrafts.id, existing.id));
        return NextResponse.json({ success: true, data: { id: existing.id }, message: "임시저장되었습니다." });
    }

    const [created] = await db
        .insert(alimtalkTemplateDrafts)
        .values({ orgId: user.orgId, senderKey, templateCode, templateName, formData })
        .returning({ id: alimtalkTemplateDrafts.id });

    return NextResponse.json({ success: true, data: { id: created.id }, message: "임시저장되었습니다." });
}
