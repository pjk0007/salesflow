import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs, emailConfigs } from "@/lib/db";
import { eq, and, gte } from "drizzle-orm";
import { getEmailClient } from "@/lib/nhn-email";

export async function POST(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    }

    const token = req.headers.get("x-secret") || req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
    if (token !== cronSecret) {
        return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    }

    try {
        // 이메일 설정이 있는 모든 조직 조회
        const configs = await db.select({ orgId: emailConfigs.orgId }).from(emailConfigs);

        const daysBack = Number(req.nextUrl.searchParams.get("days")) || 7;
        const since = new Date();
        since.setDate(since.getDate() - daysBack);
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        let totalReadUpdated = 0;
        let totalStatusCorrected = 0;
        let totalPendingUpdated = 0;
        let orgProcessed = 0;

        for (const config of configs) {
            const client = await getEmailClient(config.orgId);
            if (!client) continue;

            orgProcessed++;

            // ── pending 상태 동기화 ──
            const pendingLogs = await db
                .select()
                .from(emailSendLogs)
                .where(
                    and(
                        eq(emailSendLogs.orgId, config.orgId),
                        eq(emailSendLogs.status, "pending")
                    )
                )
                .limit(200);

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
                            await db.update(emailSendLogs).set({
                                status: newStatus,
                                resultCode: mail.resultCode,
                                resultMessage: mail.resultCodeName,
                                completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                                isOpened: mail.isOpened ? 1 : 0,
                                openedAt: mail.openedDate ? new Date(mail.openedDate) : null,
                            }).where(eq(emailSendLogs.id, log.id));
                            totalPendingUpdated++;
                        }
                    }
                } catch {
                    // 개별 조회 실패는 무시
                }
            }

            // ── sent 읽음 동기화 (최근 30일, 안읽음만) ──
            const unreadLogs = await db
                .select()
                .from(emailSendLogs)
                .where(
                    and(
                        eq(emailSendLogs.orgId, config.orgId),
                        eq(emailSendLogs.status, "sent"),
                        eq(emailSendLogs.isOpened, 0),
                        gte(emailSendLogs.sentAt, since)
                    )
                );

            const logsByRequestId = new Map<string, typeof unreadLogs>();
            for (const log of unreadLogs) {
                if (!log.requestId) continue;
                const group = logsByRequestId.get(log.requestId);
                if (group) group.push(log);
                else logsByRequestId.set(log.requestId, [log]);
            }

            let apiCallCount = 0;
            for (const [requestId, logs] of logsByRequestId) {
                // 10건마다 50ms 대기 (NHN API rate limit 방지)
                if (apiCallCount > 0 && apiCallCount % 10 === 0) await sleep(50);
                apiCallCount++;
                try {
                    const result = await client.queryMails({ requestId });
                    if (!result.header.isSuccessful || !result.data) continue;

                    for (const mail of result.data) {
                        const matchingLogs = logs.filter(
                            (l) => l.recipientEmail === mail.receiveMailAddr
                        );
                        for (const log of matchingLogs) {
                            if (mail.mailStatusCode === "SST3" || mail.mailStatusCode === "SST7") {
                                await db.update(emailSendLogs).set({
                                    status: "failed",
                                    resultCode: mail.resultCode,
                                    resultMessage: mail.resultCodeName,
                                    completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                                }).where(eq(emailSendLogs.id, log.id));
                                totalStatusCorrected++;
                                continue;
                            }
                            if (mail.isOpened) {
                                await db.update(emailSendLogs).set({
                                    isOpened: 1,
                                    openedAt: mail.openedDate ? new Date(mail.openedDate) : new Date(),
                                }).where(eq(emailSendLogs.id, log.id));
                                totalReadUpdated++;
                            }
                        }
                    }
                } catch {
                    // 개별 조회 실패는 무시
                }
            }
        }

        console.log(`[cron/email-read-sync] 완료: ${orgProcessed}개 조직, pending=${totalPendingUpdated}, 읽음=${totalReadUpdated}, 상태보정=${totalStatusCorrected}`);

        return NextResponse.json({
            success: true,
            data: {
                orgProcessed,
                pendingUpdated: totalPendingUpdated,
                readUpdated: totalReadUpdated,
                statusCorrected: totalStatusCorrected,
            },
        });
    } catch (error) {
        console.error("Email read sync cron error:", error);
        return NextResponse.json({ success: false, error: "처리에 실패했습니다." }, { status: 500 });
    }
}
