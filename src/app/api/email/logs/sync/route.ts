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
                    else if (mail.mailStatusCode === "SST3" || mail.mailStatusCode === "SST7") newStatus = "failed";

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

        // ── 단계 2: sent 상태 동기화 (실제 NHN 상태 반영 + 읽음 체크, 최근 30일) ──
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        let statusCorrected = 0;

        const sentLogs = await db
            .select()
            .from(emailSendLogs)
            .where(
                and(
                    eq(emailSendLogs.orgId, user.orgId),
                    eq(emailSendLogs.status, "sent"),
                    gte(emailSendLogs.sentAt, thirtyDaysAgo)
                )
            );

        // requestId 기준으로 그룹핑해 NHN API 호출 최소화
        const logsByRequestId = new Map<string, typeof sentLogs>();
        for (const log of sentLogs) {
            if (!log.requestId) continue;
            const group = logsByRequestId.get(log.requestId);
            if (group) group.push(log);
            else logsByRequestId.set(log.requestId, [log]);
        }

        for (const [requestId, logs] of logsByRequestId) {
            try {
                const result = await client.queryMails({ requestId });
                if (!result.header.isSuccessful || !result.data) continue;

                for (const mail of result.data) {
                    const matchingLogs = logs.filter(
                        (l) => l.recipientEmail === mail.receiveMailAddr
                    );

                    for (const log of matchingLogs) {
                        // 실제 NHN 상태가 실패/미인증이면 상태 보정
                        if (mail.mailStatusCode === "SST3" || mail.mailStatusCode === "SST7") {
                            await db
                                .update(emailSendLogs)
                                .set({
                                    status: "failed",
                                    resultCode: mail.resultCode,
                                    resultMessage: mail.resultCodeName,
                                    completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                                })
                                .where(eq(emailSendLogs.id, log.id));
                            statusCorrected++;
                            continue;
                        }

                        // 읽음 동기화
                        if (mail.isOpened && log.isOpened === 0) {
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
                }
            } catch {
                // 개별 조회 실패는 무시
            }
        }

        return NextResponse.json({
            success: true,
            data: { synced: pendingLogs.length, updated, sentChecked: sentLogs.length, statusCorrected, readUpdated },
        });
    } catch (error) {
        console.error("Email sync error:", error);
        return NextResponse.json({ success: false, error: "동기화에 실패했습니다." }, { status: 500 });
    }
}
