import { isCompleteRecordFilter } from "@/lib/record-filter-input";
import { NextRequest, NextResponse } from "next/server";
import { deleteRecordsWhere } from "@/lib/record-delete";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { buildRecordConditions, type RecordFilter } from "@/lib/record-filters";
import { broadcastToPartition } from "@/lib/sse";

/**
 * 조건 삭제 — 지정한 필터 조건에 매칭되는 레코드를 한 번에 삭제.
 * 안전장치: 조건(filters)이 최소 1개 없으면 거부 (파티션 전체 실수 삭제 방지).
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const filters: RecordFilter[] = Array.isArray(body?.filters) ? body.filters : [];
    if (filters.length === 0 || !filters.every(isCompleteRecordFilter)) {
        return NextResponse.json({ success: false, error: "완전한 삭제 조건을 1개 이상 지정해주세요." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "delete");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const conditions = buildRecordConditions(partitionId, { filters });

        // 삭제 + 방문자 연결 해제(UX-064)
        const deleted = await deleteRecordsWhere(user.orgId, conditions);

        const deletedIds = deleted.map((d) => d.id);
        const sessionId = req.headers.get("x-session-id") as string;
        broadcastToPartition(partitionId, "record:bulk-deleted", { partitionId, recordIds: deletedIds }, sessionId);

        return NextResponse.json({ success: true, data: { deletedCount: deleted.length } });
    } catch (error) {
        console.error("Condition delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
