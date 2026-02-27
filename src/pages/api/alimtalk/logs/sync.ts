import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "알림톡 설정이 필요합니다." });
    }

    try {
        const { logIds } = req.body as { logIds?: number[] };

        // pending 상태인 로그 조회
        const conditions = [
            eq(alimtalkSendLogs.orgId, user.orgId),
            eq(alimtalkSendLogs.status, "pending"),
        ];
        if (logIds && logIds.length > 0) {
            conditions.push(inArray(alimtalkSendLogs.id, logIds));
        }

        const pendingLogs = await db
            .select()
            .from(alimtalkSendLogs)
            .where(and(...conditions))
            .limit(100);

        if (pendingLogs.length === 0) {
            return res.status(200).json({
                success: true,
                data: { synced: 0, updated: 0 },
            });
        }

        let updated = 0;

        for (const log of pendingLogs) {
            if (!log.requestId || log.recipientSeq == null) continue;

            try {
                const result = await client.getMessage(log.requestId, log.recipientSeq);
                if (result.header.isSuccessful && result.message) {
                    const msg = result.message;
                    const newStatus = msg.resultCode === "1000" ? "sent" : "failed";

                    if (newStatus !== log.status) {
                        await db
                            .update(alimtalkSendLogs)
                            .set({
                                status: newStatus,
                                resultCode: msg.resultCode,
                                resultMessage: msg.resultCodeName,
                                completedAt: msg.receiveDate ? new Date(msg.receiveDate) : new Date(),
                            })
                            .where(eq(alimtalkSendLogs.id, log.id));
                        updated++;
                    }
                }
            } catch {
                // 개별 조회 실패는 무시하고 다음으로 진행
            }
        }

        return res.status(200).json({
            success: true,
            data: { synced: pendingLogs.length, updated },
        });
    } catch (error) {
        console.error("Alimtalk sync error:", error);
        return res.status(500).json({ success: false, error: "동기화에 실패했습니다." });
    }
}
