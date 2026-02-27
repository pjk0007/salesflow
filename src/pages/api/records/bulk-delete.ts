import type { NextApiRequest, NextApiResponse } from "next";
import { db, records } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { broadcastToPartition } from "@/lib/sse";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: "삭제할 레코드 ID 목록이 필요합니다." });
    }

    try {
        const deleted = await db
            .delete(records)
            .where(and(inArray(records.id, ids), eq(records.orgId, user.orgId)))
            .returning({ id: records.id, partitionId: records.partitionId });

        // 파티션별로 그룹핑하여 broadcast
        const partitionIds = [...new Set(deleted.map((d) => d.partitionId))];
        const deletedIds = deleted.map((d) => d.id);
        const sessionId = req.headers["x-session-id"] as string;
        for (const pid of partitionIds) {
            broadcastToPartition(pid, "record:bulk-deleted", {
                partitionId: pid,
                recordIds: deletedIds,
            }, sessionId);
        }

        return res.status(200).json({
            success: true,
            message: `${deleted.length}건의 레코드가 삭제되었습니다.`,
            deletedCount: deleted.length,
        });
    } catch (error) {
        console.error("Bulk delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
