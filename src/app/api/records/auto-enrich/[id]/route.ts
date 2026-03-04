import { NextRequest, NextResponse } from "next/server";
import { db, recordAutoEnrichRules } from "@/lib/db";
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

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const { searchField, targetFields, isActive } = await req.json();

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (searchField !== undefined) updateData.searchField = searchField;
        if (targetFields !== undefined) updateData.targetFields = targetFields;
        if (isActive !== undefined) updateData.isActive = isActive;

        const [updated] = await db
            .update(recordAutoEnrichRules)
            .set(updateData)
            .where(and(eq(recordAutoEnrichRules.id, id), eq(recordAutoEnrichRules.orgId, user.orgId)))
            .returning();

        if (!updated) {
            return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Auto enrich rule update error:", error);
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

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    try {
        const [deleted] = await db
            .delete(recordAutoEnrichRules)
            .where(and(eq(recordAutoEnrichRules.id, id), eq(recordAutoEnrichRules.orgId, user.orgId)))
            .returning({ id: recordAutoEnrichRules.id });

        if (!deleted) {
            return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Auto enrich rule delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
