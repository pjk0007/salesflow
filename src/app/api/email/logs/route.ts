import { NextRequest, NextResponse } from "next/server";
import { db, emailSendLogs } from "@/lib/db";
import { eq, and, desc, sql } from "drizzle-orm";
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

        const partitionId = searchParams.get("partitionId");
        if (partitionId) {
            conditions.push(eq(emailSendLogs.partitionId, Number(partitionId)));
        }
        const triggerType = searchParams.get("triggerType");
        if (triggerType) {
            conditions.push(eq(emailSendLogs.triggerType, triggerType));
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

        return NextResponse.json({
            success: true,
            data: logs,
            totalCount: Number(countResult.count),
        });
    } catch (error) {
        console.error("Email logs fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
