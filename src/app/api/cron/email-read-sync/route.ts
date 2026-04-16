import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs, emailConfigs } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getEmailClient } from "@/lib/nhn-email";

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
        const configs = await db.select({ orgId: emailConfigs.orgId }).from(emailConfigs);

        const daysBack = Number(req.nextUrl.searchParams.get("days")) || 7;
        const pageSize = 100;
        const since = new Date();
        since.setDate(since.getDate() - daysBack);
        const now = new Date();
        now.setDate(now.getDate() + 1); // endSendDate는 exclusive이므로 +1

        let totalReadUpdated = 0;
        let totalStatusCorrected = 0;
        let totalPendingUpdated = 0;
        let totalApiCalls = 0;
        let orgProcessed = 0;

        for (const config of configs) {
            const client = await getEmailClient(config.orgId);
            if (!client) continue;

            orgProcessed++;

            // ── 1단계: pending 상태 동기화 (requestId별 — pending은 소수) ──
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
                totalApiCalls++;
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

            // ── 2단계: 기간 조회 → 읽음/상태 동기화 (페이징) ──
            // DB에서 안읽음 requestId를 빠르게 조회용 Set으로 준비
            const unreadRows = await db
                .select({ requestId: emailSendLogs.requestId, id: emailSendLogs.id, recipientEmail: emailSendLogs.recipientEmail })
                .from(emailSendLogs)
                .where(
                    and(
                        eq(emailSendLogs.orgId, config.orgId),
                        eq(emailSendLogs.status, "sent"),
                        eq(emailSendLogs.isOpened, 0),
                        sql`${emailSendLogs.sentAt} >= ${since}`
                    )
                );

            if (unreadRows.length === 0) continue;

            // requestId → log id/email 매핑
            const unreadMap = new Map<string, Array<{ id: number; recipientEmail: string }>>();
            for (const row of unreadRows) {
                if (!row.requestId) continue;
                const list = unreadMap.get(row.requestId);
                if (list) list.push({ id: row.id, recipientEmail: row.recipientEmail });
                else unreadMap.set(row.requestId, [{ id: row.id, recipientEmail: row.recipientEmail }]);
            }

            // NHN API 기간 조회 — 페이징으로 전체 순회
            let pageNum = 1;
            let hasMore = true;

            while (hasMore) {
                totalApiCalls++;
                try {
                    const result = await client.queryMailsPaged({
                        startSendDate: formatDate(since),
                        endSendDate: formatDate(now),
                        pageNum,
                        pageSize,
                    });

                    if (!result.header.isSuccessful || !result.data || result.data.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const mail of result.data) {
                        const logs = unreadMap.get(mail.requestId);
                        if (!logs) continue; // DB에 안읽음이 없는 건 → 스킵

                        for (const log of logs) {
                            if (log.recipientEmail !== mail.receiveMailAddr) continue;

                            // 실패 상태 보정
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

                            // 읽음 업데이트
                            if (mail.isOpened) {
                                await db.update(emailSendLogs).set({
                                    isOpened: 1,
                                    openedAt: mail.openedDate ? new Date(mail.openedDate) : new Date(),
                                }).where(eq(emailSendLogs.id, log.id));
                                totalReadUpdated++;
                                // 매칭 완료된 건 제거 (중복 처리 방지)
                                const idx = logs.indexOf(log);
                                if (idx !== -1) logs.splice(idx, 1);
                            }
                        }
                    }

                    // 다음 페이지
                    if (result.data.length < pageSize || pageNum * pageSize >= result.totalCount) {
                        hasMore = false;
                    } else {
                        pageNum++;
                    }
                } catch (err) {
                    console.error(`[cron/email-read-sync] API 페이징 에러 (page=${pageNum}):`, err);
                    hasMore = false;
                }
            }
        }

        console.log(`[cron/email-read-sync] 완료: ${orgProcessed}개 조직, API ${totalApiCalls}회, pending=${totalPendingUpdated}, 읽음=${totalReadUpdated}, 상태보정=${totalStatusCorrected}`);

        return NextResponse.json({
            success: true,
            data: {
                orgProcessed,
                apiCalls: totalApiCalls,
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
