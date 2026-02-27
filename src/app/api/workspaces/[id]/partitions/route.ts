import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, folders, partitions, fieldDefinitions } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
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

    try {
        // 워크스페이스 소유권 검증
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        // 폴더 목록
        const folderList = await db
            .select()
            .from(folders)
            .where(eq(folders.workspaceId, workspaceId))
            .orderBy(asc(folders.displayOrder), asc(folders.id));

        // 파티션 목록
        const partitionList = await db
            .select()
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId))
            .orderBy(asc(partitions.displayOrder), asc(partitions.id));

        // 폴더별 파티션 그룹핑
        const folderMap = folderList.map((folder) => ({
            ...folder,
            partitions: partitionList.filter((p) => p.folderId === folder.id),
        }));

        // 미분류 파티션 (folderId가 null)
        const ungrouped = partitionList.filter((p) => p.folderId === null);

        return NextResponse.json({
            success: true,
            data: {
                folders: folderMap,
                ungrouped,
            },
        });
    } catch (error) {
        console.error("Partitions fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

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

    const { name, folderId } = await req.json();
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

        // folderId 검증
        if (folderId) {
            const [folder] = await db
                .select({ id: folders.id })
                .from(folders)
                .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
            if (!folder) {
                return NextResponse.json({ success: false, error: "폴더를 찾을 수 없습니다." }, { status: 400 });
            }
        }

        // 기본 visibleFields: 워크스페이스의 전체 필드 key 목록
        const fieldList = await db
            .select({ key: fieldDefinitions.key })
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, workspaceId))
            .orderBy(asc(fieldDefinitions.sortOrder));

        const visibleFields = fieldList.map((f) => f.key);

        const [created] = await db
            .insert(partitions)
            .values({
                workspaceId,
                name: name.trim(),
                folderId: folderId || null,
                visibleFields,
            })
            .returning({
                id: partitions.id,
                name: partitions.name,
                folderId: partitions.folderId,
            });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Partition create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
