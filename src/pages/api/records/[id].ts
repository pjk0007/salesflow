import type { NextApiRequest, NextApiResponse } from "next";
import { db, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { broadcastToPartition } from "@/lib/sse";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "PATCH") return handlePatch(req, res);
    if (req.method === "DELETE") return handleDelete(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const recordId = Number(req.query.id);
    if (!recordId) {
        return res.status(400).json({ success: false, error: "레코드 ID가 필요합니다." });
    }

    const { data: newData } = req.body;
    if (!newData || typeof newData !== "object") {
        return res.status(400).json({ success: false, error: "수정할 데이터가 필요합니다." });
    }

    try {
        // 레코드 조회 + 조직 검증
        const [existing] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return res.status(404).json({ success: false, error: "레코드를 찾을 수 없습니다." });
        }

        // 기존 data와 병합
        const mergedData = { ...(existing.data as Record<string, unknown>), ...newData };

        const [updated] = await db
            .update(records)
            .set({ data: mergedData, updatedAt: new Date() })
            .where(eq(records.id, recordId))
            .returning();

        processAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: user.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: user.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(updated.partitionId, "record:updated", {
            partitionId: updated.partitionId,
            recordId: updated.id,
        }, req.headers["x-session-id"] as string);

        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Record update error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const recordId = Number(req.query.id);
    if (!recordId) {
        return res.status(400).json({ success: false, error: "레코드 ID가 필요합니다." });
    }

    try {
        const [existing] = await db
            .select({ id: records.id, partitionId: records.partitionId })
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return res.status(404).json({ success: false, error: "레코드를 찾을 수 없습니다." });
        }

        await db.delete(records).where(eq(records.id, recordId));

        broadcastToPartition(existing.partitionId, "record:deleted", {
            partitionId: existing.partitionId,
            recordId: existing.id,
        }, req.headers["x-session-id"] as string);

        return res.status(200).json({ success: true, message: "레코드가 삭제되었습니다." });
    } catch (error) {
        console.error("Record delete error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
