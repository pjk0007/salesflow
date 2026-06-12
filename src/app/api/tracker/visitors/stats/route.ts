import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getVisitorIdsByChannel } from "@/lib/tracker/session-filter";
import { pagePathExpr } from "@/lib/tracker/page-path";

/**
 * 트래커 방문자 전체 집계 통계.
 * "사람" 단위 — record 있으면 record로 묶고, 없으면 visitor 단독.
 *
 * 필터:
 * - pagePath: 해당 경로를 본 방문자만 + 페이지뷰는 그 경로의 PAGE_VIEW 수로 전환
 * - channel: 첫 세션 유입 채널 기준 방문자 필터
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const siteIdStr = sp.get("siteId");
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

    const pagePath = sp.get("pagePath")?.trim() || null;
    const channel = sp.get("channel")?.trim() || null;

    // 채널 필터 → 매칭 방문자 ID 사전 추출 (null이면 미적용)
    const channelVisitorIds = await getVisitorIdsByChannel({ siteId, channel });

    const visitorIdInSql = (col: string): SQL | null => {
        if (channelVisitorIds === null) return null;
        if (channelVisitorIds.length === 0) return sql`FALSE`;
        return sql`${sql.raw(col)} IN (${sql.join(channelVisitorIds.map((id) => sql`${id}`), sql`, `)})`;
    };

    const filters = [sql`site_id = ${siteId}`];
    const channelFilter = visitorIdInSql("id");
    if (channelFilter) filters.push(channelFilter);
    if (pagePath) {
        filters.push(sql`EXISTS (
            SELECT 1 FROM tracker_events ev
            WHERE ev.visitor_id = tracker_visitors.id
              AND ev.event_type = 'PAGE_VIEW'
              AND ${pagePathExpr("ev.page_url")} = ${pagePath}
        )`);
    }
    const whereSql = sql.join(filters, sql` AND `);

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
            WHERE ${whereSql}
            GROUP BY COALESCE('r' || record_id, 'v' || id::text)
        ) g
    `)) as unknown as Array<{
        total_visitors: number;
        identified_visitors: number;
        total_pageviews: number;
    }>;

    const s = rows[0];

    // 페이지 필터 시 페이지뷰는 visitor 누적값이 아닌 해당 경로의 PAGE_VIEW 수
    let totalPageviews = s?.total_pageviews ?? 0;
    if (pagePath) {
        const pvFilters = [
            sql`ev.site_id = ${siteId}`,
            sql`ev.event_type = 'PAGE_VIEW'`,
            sql`${pagePathExpr("ev.page_url")} = ${pagePath}`,
        ];
        const pvChannelFilter = visitorIdInSql("ev.visitor_id");
        if (pvChannelFilter) pvFilters.push(pvChannelFilter);

        const pvRows = (await db.execute(sql`
            SELECT COUNT(*)::int AS pageviews
            FROM tracker_events ev
            WHERE ${sql.join(pvFilters, sql` AND `)}
        `)) as unknown as Array<{ pageviews: number }>;
        totalPageviews = pvRows[0]?.pageviews ?? 0;
    }

    return NextResponse.json({
        success: true,
        data: {
            totalVisitors: s?.total_visitors ?? 0,
            identifiedVisitors: s?.identified_visitors ?? 0,
            totalPageviews,
        },
    });
}
