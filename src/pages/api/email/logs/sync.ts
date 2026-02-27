import type { NextApiRequest, NextApiResponse } from "next";
import { db, emailSendLogs } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "이메일 설정이 필요합니다." });
    }

    try {
        // pending 상태인 로그 조회
        const pendingLogs = await db
            .select()
            .from(emailSendLogs)
            .where(
                and(
                    eq(emailSendLogs.orgId, user.orgId),
                    eq(emailSendLogs.status, "pending")
                )
            )
            .limit(100);

        if (pendingLogs.length === 0) {
            return res.status(200).json({
                success: true,
                data: { synced: 0, updated: 0 },
            });
        }

        let updated = 0;

        // requestId별로 그룹핑하여 조회
        const requestIds = [...new Set(pendingLogs.map((l) => l.requestId).filter(Boolean))];

        for (const requestId of requestIds) {
            if (!requestId) continue;

            try {
                const result = await client.queryMails({ requestId });
                if (!result.header.isSuccessful || !result.data) continue;

                for (const mail of result.data) {
                    // SST2=발송완료, SST3=발송실패, SST5=수신거부
                    let newStatus: string | null = null;
                    if (mail.mailStatusCode === "SST2") newStatus = "sent";
                    else if (mail.mailStatusCode === "SST3") newStatus = "failed";
                    else if (mail.mailStatusCode === "SST5") newStatus = "rejected";

                    if (!newStatus) continue;

                    // 해당 requestId + 수신자의 로그 업데이트
                    const matchingLogs = pendingLogs.filter(
                        (l) => l.requestId === requestId && l.recipientEmail === mail.receiveMailAddr
                    );

                    for (const log of matchingLogs) {
                        await db
                            .update(emailSendLogs)
                            .set({
                                status: newStatus,
                                resultCode: mail.resultCode,
                                resultMessage: mail.resultCodeName,
                                completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                            })
                            .where(eq(emailSendLogs.id, log.id));
                        updated++;
                    }
                }
            } catch {
                // 개별 조회 실패는 무시
            }
        }

        return res.status(200).json({
            success: true,
            data: { synced: pendingLogs.length, updated },
        });
    } catch (error) {
        console.error("Email sync error:", error);
        return res.status(500).json({ success: false, error: "동기화에 실패했습니다." });
    }
}
