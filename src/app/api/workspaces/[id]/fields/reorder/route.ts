import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, fieldDefinitions } from "@/lib/db";
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
    const workspaceId = Number(id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스 ID가 필요합니다." }, { status: 400 });
    }

    const { fieldIds } = await req.json();
    if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
        return NextResponse.json({ success: false, error: "fieldIds 배열이 필요합니다." }, { status: 400 });
    }

    try {
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        // 각 fieldId에 대해 sortOrder 업데이트
        for (let i = 0; i < fieldIds.length; i++) {
            await db
                .update(fieldDefinitions)
                .set({ sortOrder: i, updatedAt: new Date() })
                .where(
                    and(
                        eq(fieldDefinitions.id, fieldIds[i]),
                        eq(fieldDefinitions.workspaceId, workspaceId)
                    )
                );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Fields reorder error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
