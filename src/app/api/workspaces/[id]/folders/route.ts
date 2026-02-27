import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, folders } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function POST(
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

    const { name } = await req.json();
    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        // 워크스페이스 소유권 검증
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        const [created] = await db
            .insert(folders)
            .values({
                workspaceId,
                name: name.trim(),
            })
            .returning({
                id: folders.id,
                name: folders.name,
            });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Folder create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
