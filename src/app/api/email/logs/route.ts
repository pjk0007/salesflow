import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs, emailClickLogs } from "@/lib/db";
import { eq, and, desc, sql, gte, lte, inArray, or, ilike } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const page = Number(searchParams.get("page")) || 1;
        const pageSize = Math.min(Number(searchParams.get("pageSize")) || 50, 100);
        const offset = (page - 1) * pageSize;

        const conditions = [eq(emailSendLogs.orgId, user.orgId)];

        const search = searchParams.get("search");
        if (search) {
            conditions.push(
                or(
                    ilike(emailSendLogs.recipientEmail, `%${search}%`),
                    ilike(emailSendLogs.subject, `%${search}%`),
                )!
            );
        }
        const status = searchParams.get("status");
        if (status) {
            conditions.push(eq(emailSendLogs.status, status));
        }
        const partitionId = searchParams.get("partitionId");
        if (partitionId) {
            conditions.push(eq(emailSendLogs.partitionId, Number(partitionId)));
        }
        const templateLinkId = searchParams.get("templateLinkId");
        if (templateLinkId) {
            conditions.push(eq(emailSendLogs.templateLinkId, Number(templateLinkId)));
        }
        const autoPersonalizedLinkId = searchParams.get("autoPersonalizedLinkId");
        if (autoPersonalizedLinkId) {
            conditions.push(eq(emailSendLogs.autoPersonalizedLinkId, Number(autoPersonalizedLinkId)));
        }
        const triggerType = searchParams.get("triggerType");
        if (triggerType) {
            conditions.push(eq(emailSendLogs.triggerType, triggerType));
        }
        const startDate = searchParams.get("startDate");
        if (startDate) {
            conditions.push(gte(emailSendLogs.sentAt, new Date(startDate)));
        }
        const endDate = searchParams.get("endDate");
        if (endDate) {
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            conditions.push(lte(emailSendLogs.sentAt, end));
        }
        const isOpened = searchParams.get("isOpened");
        if (isOpened === "1") {
            conditions.push(eq(emailSendLogs.isOpened, 1));
            conditions.push(eq(emailSendLogs.status, "sent"));
        } else if (isOpened === "0") {
            conditions.push(eq(emailSendLogs.isOpened, 0));
            conditions.push(eq(emailSendLogs.status, "sent"));
        }
        const isClicked = searchParams.get("isClicked");
        if (isClicked === "1") {
            conditions.push(sql`EXISTS (SELECT 1 FROM email_click_logs WHERE send_log_id = ${emailSendLogs.id})`);
        } else if (isClicked === "0") {
            conditions.push(sql`NOT EXISTS (SELECT 1 FROM email_click_logs WHERE send_log_id = ${emailSendLogs.id})`);
            conditions.push(eq(emailSendLogs.status, "sent"));
        }

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailSendLogs)
            .where(and(...conditions));

        const logs = await db
            .select()
            .from(emailSendLogs)
            .where(and(...conditions))
            .orderBy(desc(emailSendLogs.sentAt))
            .limit(pageSize)
            .offset(offset);

        // 클릭 수 조회
        const logIds = logs.map(l => l.id);
        let clickCounts: Record<number, number> = {};
        if (logIds.length > 0) {
            const clicks = await db
                .select({
                    sendLogId: emailClickLogs.sendLogId,
                    count: sql<number>`count(*)::int`,
                })
                .from(emailClickLogs)
                .where(inArray(emailClickLogs.sendLogId, logIds))
                .groupBy(emailClickLogs.sendLogId);
            for (const c of clicks) {
                clickCounts[c.sendLogId] = c.count;
            }
        }

        const logsWithClicks = logs.map(log => ({
            ...log,
            clickCount: clickCounts[log.id] || 0,
        }));

        return NextResponse.json({
            success: true,
            data: logsWithClicks,
            totalCount: Number(countResult.count),
        });
    } catch (error) {
        console.error("Email logs fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
