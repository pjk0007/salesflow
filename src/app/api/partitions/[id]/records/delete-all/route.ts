import { NextRequest, NextResponse } from "next/server";
import { db, records, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
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
    const user = getUserFromNextRequest(req);
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
    if (filters.length === 0) {
        return NextResponse.json({ success: false, error: "삭제 조건을 1개 이상 지정해주세요." }, { status: 400 });
    }

    try {
        // 파티션 접근 검증
        const [access] = await db
            .select({ id: partitions.id })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const conditions = buildRecordConditions(partitionId, { filters });

        const deleted = await db
            .delete(records)
            .where(and(eq(records.orgId, user.orgId), ...conditions))
            .returning({ id: records.id });

        const deletedIds = deleted.map((d) => d.id);
        const sessionId = req.headers.get("x-session-id") as string;
        broadcastToPartition(partitionId, "record:bulk-deleted", { partitionId, recordIds: deletedIds }, sessionId);

        return NextResponse.json({ success: true, data: { deletedCount: deleted.length } });
    } catch (error) {
        console.error("Condition delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
