import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 트래커 방문자 전체 집계 통계.
 * "사람" 단위 — record 있으면 record로 묶고, 없으면 visitor 단독.
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

    // 사람 단위 그룹: record 있으면 r{id}, 없으면 v{id}
    const rows = (await db.execute(sql`
        SELECT
            COUNT(*)::int AS total_visitors,
            COUNT(*) FILTER (WHERE has_record)::int AS identified_visitors,
            COALESCE(SUM(pageviews), 0)::int AS total_pageviews
        FROM (
            SELECT
                COALESCE('r' || record_id, 'v' || id::text) AS gk,
                bool_or(record_id IS NOT NULL) AS has_record,
                SUM(total_pageviews) AS pageviews
            FROM tracker_visitors
            WHERE site_id = ${siteId}
            GROUP BY COALESCE('r' || record_id, 'v' || id::text)
        ) g
    `)) as unknown as Array<{
        total_visitors: number;
        identified_visitors: number;
        total_pageviews: number;
    }>;

    const s = rows[0];

    return NextResponse.json({
        success: true,
        data: {
            totalVisitors: s?.total_visitors ?? 0,
            identifiedVisitors: s?.identified_visitors ?? 0,
            totalPageviews: s?.total_pageviews ?? 0,
        },
    });
}
