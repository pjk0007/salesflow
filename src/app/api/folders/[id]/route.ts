import { NextRequest, NextResponse } from "next/server";
import { db, folders, partitions } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requireFolderAccess } from "@/lib/partition-access";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const folderId = Number(id);
    if (!folderId || isNaN(folderId)) {
        return NextResponse.json({ success: false, error: "잘못된 폴더 ID입니다." }, { status: 400 });
    }

    const { name } = await req.json();
    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        const access = await requireFolderAccess(user, folderId, "update");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const [updated] = await db
            .update(folders)
            .set({ name: name.trim(), updatedAt: new Date() })
            .where(eq(folders.id, folderId))
            .returning({ id: folders.id, name: folders.name });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Folder update error:", error);
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

    const { id } = await params;
    const folderId = Number(id);
    if (!folderId || isNaN(folderId)) {
        return NextResponse.json({ success: false, error: "잘못된 폴더 ID입니다." }, { status: 400 });
    }

    try {
        const access = await requireFolderAccess(user, folderId, "delete");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        // 하위 파티션을 미분류로 이동
        await db
            .update(partitions)
            .set({ folderId: null })
            .where(eq(partitions.folderId, folderId));

        await db.delete(folders).where(eq(folders.id, folderId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Folder delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
