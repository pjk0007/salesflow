import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs } from "@/lib/db";
import { eq, and, gte } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
    }

    try {
        let updated = 0;
        let readUpdated = 0;

        // ── 단계 1: pending 상태 동기화 ──
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

        const pendingRequestIds = [...new Set(pendingLogs.map((l) => l.requestId).filter(Boolean))];

        for (const requestId of pendingRequestIds) {
            if (!requestId) continue;

            try {
                const result = await client.queryMails({ requestId });
                if (!result.header.isSuccessful || !result.data) continue;

                for (const mail of result.data) {
                    let newStatus: string | null = null;
                    if (mail.mailStatusCode === "SST2") newStatus = "sent";
                    else if (mail.mailStatusCode === "SST3") newStatus = "failed";
                    else if (mail.mailStatusCode === "SST5") newStatus = "rejected";

                    if (!newStatus) continue;

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
                                isOpened: mail.isOpened ? 1 : 0,
                                openedAt: mail.openedDate ? new Date(mail.openedDate) : null,
                            })
                            .where(eq(emailSendLogs.id, log.id));
                        updated++;
                    }
                }
            } catch {
                // 개별 조회 실패는 무시
            }
        }

        // ── 단계 2: sent 상태 읽음 동기화 (최근 7일, 미읽음) ──
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const unreadSentLogs = await db
            .select()
            .from(emailSendLogs)
            .where(
                and(
                    eq(emailSendLogs.orgId, user.orgId),
                    eq(emailSendLogs.status, "sent"),
                    eq(emailSendLogs.isOpened, 0),
                    gte(emailSendLogs.sentAt, sevenDaysAgo)
                )
            )
            .limit(100);

        const sentRequestIds = [...new Set(unreadSentLogs.map((l) => l.requestId).filter(Boolean))];

        for (const requestId of sentRequestIds) {
            if (!requestId) continue;

            try {
                const result = await client.queryMails({ requestId });
                if (!result.header.isSuccessful || !result.data) continue;

                for (const mail of result.data) {
                    if (!mail.isOpened) continue;

                    const matchingLogs = unreadSentLogs.filter(
                        (l) => l.requestId === requestId && l.recipientEmail === mail.receiveMailAddr
                    );

                    for (const log of matchingLogs) {
                        await db
                            .update(emailSendLogs)
                            .set({
                                isOpened: 1,
                                openedAt: mail.openedDate ? new Date(mail.openedDate) : new Date(),
                            })
                            .where(eq(emailSendLogs.id, log.id));
                        readUpdated++;
                    }
                }
            } catch {
                // 개별 조회 실패는 무시
            }
        }

        return NextResponse.json({
            success: true,
            data: { synced: pendingLogs.length, updated, readUpdated },
        });
    } catch (error) {
        console.error("Email sync error:", error);
        return NextResponse.json({ success: false, error: "동기화에 실패했습니다." }, { status: 500 });
    }
}
