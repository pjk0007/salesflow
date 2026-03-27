import { NextRequest, NextResponse } from "next/server";
import { db, fieldTypes, fieldDefinitions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PATCH(
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
    const typeId = Number(id);

    const [type] = await db
        .select()
        .from(fieldTypes)
        .where(and(eq(fieldTypes.id, typeId), eq(fieldTypes.orgId, user.orgId)));

    if (!type) {
        return NextResponse.json({ success: false, error: "타입을 찾을 수 없습니다." }, { status: 404 });
    }

    const { fieldIds } = await req.json();
    if (!Array.isArray(fieldIds)) {
        return NextResponse.json({ success: false, error: "fieldIds 배열이 필요합니다." }, { status: 400 });
    }

    try {
        for (let i = 0; i < fieldIds.length; i++) {
            await db
                .update(fieldDefinitions)
                .set({ sortOrder: i, updatedAt: new Date() })
                .where(and(eq(fieldDefinitions.id, fieldIds[i]), eq(fieldDefinitions.fieldTypeId, typeId)));
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Field reorder error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
