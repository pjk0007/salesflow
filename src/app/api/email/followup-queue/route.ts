import { NextRequest, NextResponse } from "next/server";
import { db, emailFollowupQueue, emailSendLogs } from "@/lib/db";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
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

        const conditions: ReturnType<typeof eq>[] = [eq(emailFollowupQueue.orgId, user.orgId)];

        const status = searchParams.get("status");
        if (status) {
            conditions.push(eq(emailFollowupQueue.status, status));
        }
        const sourceType = searchParams.get("sourceType");
        if (sourceType) {
            conditions.push(eq(emailFollowupQueue.sourceType, sourceType));
        }
        const search = searchParams.get("search");
        if (search) {
            conditions.push(ilike(emailSendLogs.recipientEmail, `%${search}%`));
        }

        const whereClause = and(...conditions);

        const baseQuery = db
            .select({ count: sql<number>`count(*)` })
            .from(emailFollowupQueue)
            .leftJoin(emailSendLogs, eq(emailFollowupQueue.parentLogId, emailSendLogs.id))
            .where(whereClause);
        const [countResult] = await baseQuery;

        const items = await db
            .select({
                id: emailFollowupQueue.id,
                parentLogId: emailFollowupQueue.parentLogId,
                sourceType: emailFollowupQueue.sourceType,
                sourceId: emailFollowupQueue.sourceId,
                stepIndex: emailFollowupQueue.stepIndex,
                checkAt: emailFollowupQueue.checkAt,
                status: emailFollowupQueue.status,
                result: emailFollowupQueue.result,
                processedAt: emailFollowupQueue.processedAt,
                createdAt: emailFollowupQueue.createdAt,
                recipientEmail: emailSendLogs.recipientEmail,
                parentSubject: emailSendLogs.subject,
            })
            .from(emailFollowupQueue)
            .leftJoin(emailSendLogs, eq(emailFollowupQueue.parentLogId, emailSendLogs.id))
            .where(whereClause)
            .orderBy(desc(emailFollowupQueue.createdAt))
            .limit(pageSize)
            .offset(offset);

        return NextResponse.json({
            success: true,
            data: items,
            totalCount: Number(countResult.count),
        });
    } catch (error) {
        console.error("Followup queue fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
