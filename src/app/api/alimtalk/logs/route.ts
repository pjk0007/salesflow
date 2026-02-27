import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 50));
        const offset = (page - 1) * pageSize;

        const conditions = [eq(alimtalkSendLogs.orgId, user.orgId)];

        const partitionId = searchParams.get("partitionId");
        if (partitionId) {
            conditions.push(eq(alimtalkSendLogs.partitionId, Number(partitionId)));
        }
        const templateLinkId = searchParams.get("templateLinkId");
        if (templateLinkId) {
            conditions.push(eq(alimtalkSendLogs.templateLinkId, Number(templateLinkId)));
        }
        const status = searchParams.get("status");
        if (status) {
            conditions.push(eq(alimtalkSendLogs.status, status));
        }
        const startDate = searchParams.get("startDate");
        if (startDate) {
            conditions.push(gte(alimtalkSendLogs.sentAt, new Date(startDate)));
        }
        const endDate = searchParams.get("endDate");
        if (endDate) {
            const endDateObj = new Date(endDate);
            endDateObj.setHours(23, 59, 59, 999);
            conditions.push(lte(alimtalkSendLogs.sentAt, endDateObj));
        }

        const where = and(...conditions);

        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(alimtalkSendLogs)
            .where(where);

        const total = countResult.count;

        const logs = await db
            .select()
            .from(alimtalkSendLogs)
            .where(where)
            .orderBy(sql`${alimtalkSendLogs.sentAt} DESC`)
            .limit(pageSize)
            .offset(offset);

        return NextResponse.json({
            success: true,
            data: logs,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Alimtalk logs error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
