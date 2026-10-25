import { NextRequest, NextResponse } from "next/server";
import { db, records } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { deleteRecordsWhere } from "@/lib/record-delete";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { broadcastToPartition } from "@/lib/sse";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
        return NextResponse.json({ success: false, error: "삭제할 레코드 ID 목록이 필요합니다." }, { status: 400 });
    }

    try {
        // 레코드가 속한 파티션마다 삭제 권한을 먼저 확인한다 — 하나라도 없으면 아무것도 지우지 않는다
        const targets = await db
            .select({ partitionId: records.partitionId })
            .from(records)
            .where(and(eq(records.orgId, user.orgId), inArray(records.id, ids)))
            .groupBy(records.partitionId);
        const allowedPartitionIds: number[] = [];
        for (const { partitionId } of targets) {
            const access = await requirePartitionAccess(user, partitionId, "delete");
            if (!access.ok) {
                return NextResponse.json({ success: false, error: access.error }, { status: access.status });
            }
            allowedPartitionIds.push(partitionId);
        }
        if (allowedPartitionIds.length === 0) {
            return NextResponse.json({ success: true, message: "0건의 레코드가 삭제되었습니다.", deletedCount: 0 });
        }

        // 삭제 + 방문자 연결 해제(UX-064). 확인 뒤 다른 파티션으로 옮겨진 레코드는 지우지 않는다
        const deleted = await deleteRecordsWhere(user.orgId, [
            inArray(records.id, ids),
            inArray(records.partitionId, allowedPartitionIds),
        ]);

        // 파티션별로 그룹핑하여 broadcast
        const partitionIds = [...new Set(deleted.map((d) => d.partitionId))];
        const deletedIds = deleted.map((d) => d.id);
        const sessionId = req.headers.get("x-session-id") as string;
        for (const pid of partitionIds) {
            broadcastToPartition(pid, "record:bulk-deleted", {
                partitionId: pid,
                recordIds: deletedIds,
            }, sessionId);
        }

        return NextResponse.json({
            success: true,
            message: `${deleted.length}건의 레코드가 삭제되었습니다.`,
            deletedCount: deleted.length,
        });
    } catch (error) {
        console.error("Bulk delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
