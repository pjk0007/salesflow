import { NextRequest, NextResponse } from "next/server";
import { db, fieldDefinitions } from "@/lib/db";
import { asc } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { partitionFieldsWhere } from "@/lib/partition-fields";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);

    const access = await requirePartitionAccess(user, partitionId, "read");
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // 파티션 fieldTypeId → 워크스페이스 defaultFieldTypeId → 워크스페이스 필드
    const fields = await db
        .select()
        .from(fieldDefinitions)
        .where(partitionFieldsWhere(access.partition.fieldTypeId, access.workspace.defaultFieldTypeId, access.workspace.id))
        .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.id));

    return NextResponse.json({ success: true, data: fields });
}
