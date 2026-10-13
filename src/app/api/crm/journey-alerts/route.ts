import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, customerJourneyAlerts } from "@/lib/db";
import { eq, desc, and, ilike, sql, type SQL } from "drizzle-orm";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 30));
    const status = searchParams.get("status") || undefined;
    const stage = searchParams.get("stage") || undefined;
    const search = searchParams.get("search") || undefined;
    const workspaceId = searchParams.get("workspaceId") ? Number(searchParams.get("workspaceId")) : undefined;

    const conditions: SQL[] = [eq(customerJourneyAlerts.orgId, user.orgId)];
    if (workspaceId) conditions.push(eq(customerJourneyAlerts.workspaceId, workspaceId));
    if (status) conditions.push(eq(customerJourneyAlerts.status, status));
    if (stage) conditions.push(eq(customerJourneyAlerts.stage, stage));
    if (search) {
        conditions.push(
            ilike(sql`${customerJourneyAlerts.message}::text`, `%${search}%`)
        );
    }

    const where = and(...conditions);

    const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(customerJourneyAlerts)
        .where(where);

    const total = countResult.count;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await db
        .select()
        .from(customerJourneyAlerts)
        .where(where)
        .orderBy(desc(customerJourneyAlerts.lastActivityAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    return NextResponse.json({
        success: true,
        data: rows,
        total,
        page,
        pageSize,
        totalPages,
    });
}
