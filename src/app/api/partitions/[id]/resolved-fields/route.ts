import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces, fieldDefinitions } from "@/lib/db";
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
    const partitionId = Number(id);

    // 파티션 + 워크스페이스 조회
    const [access] = await db
        .select({
            partition: partitions,
            workspace: workspaces,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));

    if (!access) {
        return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
    }

    // 타입 결정: 파티션 fieldTypeId → 워크스페이스 defaultFieldTypeId
    const resolvedTypeId = access.partition.fieldTypeId ?? access.workspace.defaultFieldTypeId;

    if (!resolvedTypeId) {
        // 타입이 없으면 기존 워크스페이스 기반으로 폴백
        const fields = await db
            .select()
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, access.workspace.id))
            .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));

        return NextResponse.json({ success: true, data: fields });
    }

    const fields = await db
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.fieldTypeId, resolvedTypeId))
        .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));

    return NextResponse.json({ success: true, data: fields });
}
