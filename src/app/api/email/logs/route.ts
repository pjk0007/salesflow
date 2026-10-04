import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs, emailClickLogs, emailSenderProfiles } from "@/lib/db";
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
        const isClicked = searchParams.get("isClicked");
        if (isClicked === "1") {
            conditions.push(sql`EXISTS (SELECT 1 FROM email_click_logs ecl WHERE ecl.send_log_id = email_send_logs.id)`);
        } else if (isClicked === "0") {
            conditions.push(sql`NOT EXISTS (SELECT 1 FROM email_click_logs ecl WHERE ecl.send_log_id = email_send_logs.id)`);
            conditions.push(eq(emailSendLogs.status, "sent"));
        }

        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailSendLogs)
            .where(and(...conditions));

        // 보낸 주소: 줄마다 senderEmail(보낼 때 실제로 쓴 주소, email_send_logs.sender_email — 0073부터 저장, 옛 로그는 null)과
        // senderProfile(sender_profile_id로 붙인 이 조직 발신 프로필의 **지금** 값)을 함께 준다 (DESIGN-2 4절 ②, DESIGN-3 4-1).
        // 화면은 senderEmail을 먼저 쓴다 — 프로필 주소를 나중에 바꿔도 이력의 보낸 주소는 그대로다 (R7).
        // 다른 조직 프로필은 붙지 않게 조직을 조인 조건에 둔다. 지워진 프로필이면 null
        const rows = await db
            .select({
                log: emailSendLogs,
                senderName: emailSenderProfiles.name,
                senderFromEmail: emailSenderProfiles.fromEmail,
            })
            .from(emailSendLogs)
            .leftJoin(
                emailSenderProfiles,
                and(
                    eq(emailSenderProfiles.id, emailSendLogs.senderProfileId),
                    eq(emailSenderProfiles.orgId, user.orgId)
                )
            )
            .where(and(...conditions))
            .orderBy(desc(emailSendLogs.sentAt))
            .limit(pageSize)
            .offset(offset);
        const logs = rows.map((r) => ({
            ...r.log,
            senderProfile:
                r.log.senderProfileId !== null && r.senderFromEmail !== null
                    ? { id: r.log.senderProfileId, name: r.senderName ?? "", fromEmail: r.senderFromEmail }
                    : null,
        }));

        // 클릭 수 조회
        const logIds = logs.map(l => l.id);
        const clickCounts: Record<number, number> = {};
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
