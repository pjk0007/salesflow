import { NextRequest, NextResponse } from "next/server";
import { db, folders } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { requireWorkspaceCreateAccess } from "@/lib/partition-access";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const workspaceId = Number(id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스 ID가 필요합니다." }, { status: 400 });
    }

    const access = await requireWorkspaceCreateAccess(user, workspaceId);
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { name } = await req.json();
    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
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
