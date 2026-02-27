import { NextRequest, NextResponse } from "next/server";
import { db, records } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { broadcastToPartition } from "@/lib/sse";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ success: false, error: "삭제할 레코드 ID 목록이 필요합니다." }, { status: 400 });
    }

    try {
        const deleted = await db
            .delete(records)
            .where(and(inArray(records.id, ids), eq(records.orgId, user.orgId)))
            .returning({ id: records.id, partitionId: records.partitionId });

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
