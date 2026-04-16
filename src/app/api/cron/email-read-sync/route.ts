import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs, emailConfigs } from "@/lib/db";
import { eq, and } from "drizzle-orm";
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
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 1);

        let totalReadUpdated = 0;
        let totalStatusCorrected = 0;
        let totalApiCalls = 0;
        let orgProcessed = 0;

        for (const config of configs) {
            const client = await getEmailClient(config.orgId);
            if (!client) continue;

            orgProcessed++;

            // NHN API 기간 조회 → 페이징하면서 읽음/상태 직접 UPDATE
            // 메모리에 DB 로그를 올리지 않고, NHN 응답의 requestId로 DB 직접 매칭
            let pageNum = 1;
            let hasMore = true;

            while (hasMore) {
                totalApiCalls++;
                try {
                    const result = await client.queryMailsPaged({
                        startSendDate: formatDate(since),
                        endSendDate: formatDate(endDate),
                        pageNum,
                        pageSize,
                    });

                    if (!result.header.isSuccessful || !result.data || result.data.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const mail of result.data) {
                        // 실패 상태 보정 (sent → failed)
                        if (mail.mailStatusCode === "SST3" || mail.mailStatusCode === "SST7") {
                            const rows = await db.update(emailSendLogs).set({
                                status: "failed",
                                resultCode: mail.resultCode,
                                resultMessage: mail.resultCodeName,
                                completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                            }).where(
                                and(
                                    eq(emailSendLogs.orgId, config.orgId),
                                    eq(emailSendLogs.requestId, mail.requestId),
                                    eq(emailSendLogs.recipientEmail, mail.receiveMailAddr),
                                    eq(emailSendLogs.status, "sent"),
                                )
                            ).returning({ id: emailSendLogs.id });
                            totalStatusCorrected += rows.length;
                            continue;
                        }

                        // 읽음 업데이트 (isOpened=true인데 DB에 아직 0인 건)
                        if (mail.isOpened) {
                            const rows = await db.update(emailSendLogs).set({
                                isOpened: 1,
                                openedAt: mail.openedDate ? new Date(mail.openedDate) : new Date(),
                            }).where(
                                and(
                                    eq(emailSendLogs.orgId, config.orgId),
                                    eq(emailSendLogs.requestId, mail.requestId),
                                    eq(emailSendLogs.recipientEmail, mail.receiveMailAddr),
                                    eq(emailSendLogs.isOpened, 0),
                                )
                            ).returning({ id: emailSendLogs.id });
                            totalReadUpdated += rows.length;
                        }

                        // pending → sent/failed 보정
                        if (mail.mailStatusCode === "SST2") {
                            const rows = await db.update(emailSendLogs).set({
                                status: "sent",
                                resultCode: mail.resultCode,
                                resultMessage: mail.resultCodeName,
                                completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
                                isOpened: mail.isOpened ? 1 : 0,
                                openedAt: mail.openedDate ? new Date(mail.openedDate) : null,
                            }).where(
                                and(
                                    eq(emailSendLogs.orgId, config.orgId),
                                    eq(emailSendLogs.requestId, mail.requestId),
                                    eq(emailSendLogs.recipientEmail, mail.receiveMailAddr),
                                    eq(emailSendLogs.status, "pending"),
                                )
                            ).returning({ id: emailSendLogs.id });
                            totalStatusCorrected += rows.length;
                        }
                    }

                    // 다음 페이지
                    if (result.data.length < pageSize || pageNum * pageSize >= result.totalCount) {
                        hasMore = false;
                    } else {
                        pageNum++;
                    }
                } catch (err) {
                    console.error(`[cron/email-read-sync] API 에러 (page=${pageNum}):`, err);
                    hasMore = false;
                }
            }
        }

        console.log(`[cron/email-read-sync] 완료: ${orgProcessed}개 조직, API ${totalApiCalls}회, 읽음=${totalReadUpdated}, 상태보정=${totalStatusCorrected}`);

        return NextResponse.json({
            success: true,
            data: {
                orgProcessed,
                apiCalls: totalApiCalls,
                readUpdated: totalReadUpdated,
                statusCorrected: totalStatusCorrected,
            },
        });
    } catch (error) {
        console.error("Email read sync cron error:", error);
        return NextResponse.json({ success: false, error: "처리에 실패했습니다." }, { status: 500 });
    }
}
