import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { pagePathExpr } from "@/lib/tracker/page-path";

/**
 * 사이트의 방문된 페이지 목록 — path 기준 그룹, 최신 title + 페이지뷰 수.
 * 방문자 탭 페이지 필터 드롭다운용. 페이지뷰 많은 순 상위 100개.
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

    const rows = (await db.execute(sql`
        WITH pv AS (
            SELECT ${pagePathExpr("page_url")} AS path, page_title, occurred_at
            FROM tracker_events
            WHERE site_id = ${siteId} AND event_type = 'PAGE_VIEW' AND page_url IS NOT NULL
        )
        SELECT
            path,
            (ARRAY_AGG(page_title ORDER BY occurred_at DESC)
                FILTER (WHERE page_title IS NOT NULL AND page_title <> ''))[1] AS title,
            COUNT(*)::int AS views
        FROM pv
        GROUP BY path
        ORDER BY views DESC
        LIMIT 100
    `)) as unknown as Array<{ path: string; title: string | null; views: number }>;

    return NextResponse.json({
        success: true,
        data: rows.map((r) => ({
            path: r.path,
            title: r.title ?? null,
            views: Number(r.views) || 0,
        })),
    });
}
