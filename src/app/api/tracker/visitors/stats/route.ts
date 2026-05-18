import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors } from "@/lib/db";
import { eq, and, count, sum, isNotNull, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 트래커 방문자 전체 집계 통계.
 * 목록 페이지네이션과 무관하게 site 전체 기준으로 계산.
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const siteIdStr = req.nextUrl.searchParams.get("siteId");
    if (!siteIdStr) {
        return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });
    }
    const siteId = Number(siteIdStr);

    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    const [stats] = await db
        .select({
            totalVisitors: count(),
            identifiedVisitors: count(
                sql`CASE WHEN ${trackerVisitors.recordId} IS NOT NULL THEN 1 END`,
            ),
            totalPageviews: sum(trackerVisitors.totalPageviews),
        })
        .from(trackerVisitors)
        .where(eq(trackerVisitors.siteId, site.id));

    return NextResponse.json({
        success: true,
        data: {
            totalVisitors: Number(stats.totalVisitors) || 0,
            identifiedVisitors: Number(stats.identifiedVisitors) || 0,
            totalPageviews: Number(stats.totalPageviews) || 0,
        },
    });
}
