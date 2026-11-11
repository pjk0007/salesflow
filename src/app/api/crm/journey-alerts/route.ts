import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { customerJourneyAlerts } from "@/lib/db/schema";
import { eq, desc, and, ilike, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getReadonlyDb() {
    const url = process.env.READONLY_DATABASE_URL;
    if (!url) throw new Error("READONLY_DATABASE_URL이 설정되지 않았습니다.");
    const client = postgres(url, { max: 3 });
    return drizzle(client);
}

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

    const readonlyDb = getReadonlyDb();

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

    const [countResult] = await readonlyDb
        .select({ count: sql<number>`count(*)::int` })
        .from(customerJourneyAlerts)
        .where(where);

    const total = countResult.count;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await readonlyDb
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
