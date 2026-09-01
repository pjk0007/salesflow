import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, folders, partitions, fieldDefinitions } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { filterAccessiblePartitions, loadOrgScopes, requireWorkspaceCreateAccess } from "@/lib/partition-access";

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
        const allPartitions = await db
            .select()
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId))
            .orderBy(asc(partitions.displayOrder), asc(partitions.id));

        // 그룹핑 전에 걸러야 폴더 안팎을 따로 손보지 않는다
        const partitionList =
            user.role === "member"
                ? filterAccessiblePartitions({
                      user,
                      partitions: allPartitions,
                      permission: "read",
                      orgScopes: await loadOrgScopes(user.orgId),
                  })
                : allPartitions;

        // 폴더별 파티션 그룹핑.
        // member에게는 볼 수 있는 파티션이 하나도 없는 폴더를 숨긴다 —
        // 남겨두면 폴더 이름만 노출된다. 단 원래 비어 있던 폴더는 그대로 보인다.
        const emptyFolderIds = new Set(
            allPartitions.length === partitionList.length
                ? []
                : folderList
                      .filter(
                          (f) =>
                              allPartitions.some((p) => p.folderId === f.id) &&
                              !partitionList.some((p) => p.folderId === f.id)
                      )
                      .map((f) => f.id)
        );
        const folderMap = folderList
            .filter((folder) => !emptyFolderIds.has(folder.id))
            .map((folder) => ({
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
    const { id } = await params;
    const workspaceId = Number(id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스 ID가 필요합니다." }, { status: 400 });
    }

    // member는 그 워크스페이스에 create 권한이 있어야 한다 (allow 기본 아님)
    const access = await requireWorkspaceCreateAccess(user, workspaceId);
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { name, folderId, fieldTypeId } = await req.json();
    if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
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
                fieldTypeId: fieldTypeId || null,
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
