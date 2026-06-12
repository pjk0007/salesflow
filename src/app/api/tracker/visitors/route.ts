import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getVisitorIdsByChannel } from "@/lib/tracker/session-filter";
import { pagePathExpr } from "@/lib/tracker/page-path";

const PAGE_SIZE = 50;

/**
 * 방문자 목록 — "사람" 단위.
 * - record_id 있으면 record 기준으로 그룹 (여러 visitor를 1명으로 합산)
 * - record_id 없으면 visitor 단독 (익명)
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

    const page = Math.max(1, Number(sp.get("page")) || 1);
    const q = sp.get("q")?.trim();
    const hasRecord = sp.get("hasRecord"); // "true" | "false" | null
    const pagePath = sp.get("pagePath")?.trim() || null;
    const channel = sp.get("channel")?.trim() || null;

    // 채널 필터 → 첫 세션 채널이 매칭되는 방문자 ID (null이면 미적용)
    const channelVisitorIds = await getVisitorIdsByChannel({ siteId, channel });

    // WHERE 절 (raw)
    const filters = [sql`site_id = ${siteId}`];
    if (hasRecord === "true") filters.push(sql`record_id IS NOT NULL`);
    else if (hasRecord === "false") filters.push(sql`record_id IS NULL`);
    if (q) {
        const term = `%${q}%`;
        filters.push(
            sql`(email ILIKE ${term} OR name ILIKE ${term} OR visitor_id ILIKE ${term})`,
        );
    }
    if (channelVisitorIds !== null) {
        if (channelVisitorIds.length === 0) filters.push(sql`FALSE`);
        else filters.push(sql`id IN (${sql.join(channelVisitorIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (pagePath) {
        filters.push(sql`EXISTS (
            SELECT 1 FROM tracker_events ev
            WHERE ev.visitor_id = tracker_visitors.id
              AND ev.event_type = 'PAGE_VIEW'
              AND ${pagePathExpr("ev.page_url")} = ${pagePath}
        )`);
    }
    const whereSql = sql.join(filters, sql` AND `);

    // 그룹 키: record 있으면 r{record_id}, 없으면 v{id}
    const groupKey = sql`COALESCE('r' || record_id, 'v' || id::text)`;

    // 전체 그룹 수
    const countRows = (await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM (
            SELECT ${groupKey} AS gk
            FROM tracker_visitors
            WHERE ${whereSql}
            GROUP BY ${groupKey}
        ) g
    `)) as unknown as Array<{ total: number }>;
    const total = countRows[0]?.total ?? 0;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * PAGE_SIZE;

    // 그룹 집계
    const rows = (await db.execute(sql`
        SELECT
            MIN(id) AS id,
            MAX(record_id) AS record_id,
            MAX(visitor_id) AS visitor_id,
            MAX(email) AS email,
            MAX(name) AS name,
            MIN(first_seen_at) AS first_seen_at,
            MAX(last_seen_at) AS last_seen_at,
            SUM(total_visits)::int AS total_visits,
            SUM(total_pageviews)::int AS total_pageviews,
            SUM(total_events)::int AS total_events,
            COUNT(*)::int AS device_count,
            (ARRAY_AGG(device_type ORDER BY last_seen_at DESC))[1] AS device_type,
            (ARRAY_AGG(browser ORDER BY last_seen_at DESC))[1] AS browser,
            (ARRAY_AGG(os ORDER BY last_seen_at DESC))[1] AS os,
            (ARRAY_AGG(last_utm_source ORDER BY last_seen_at DESC))[1] AS last_utm_source,
            (ARRAY_AGG(last_utm_campaign ORDER BY last_seen_at DESC))[1] AS last_utm_campaign,
            (ARRAY_AGG(last_page ORDER BY last_seen_at DESC))[1] AS last_page,
            (ARRAY_AGG(last_event ORDER BY last_seen_at DESC))[1] AS last_event,
            MAX(last_event_at) AS last_event_at
        FROM tracker_visitors
        WHERE ${whereSql}
        GROUP BY ${groupKey}
        ORDER BY MAX(last_seen_at) DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const data = rows.map((r) => ({
        id: Number(r.id),
        recordId: r.record_id != null ? Number(r.record_id) : null,
        visitorId: String(r.visitor_id ?? ""),
        email: (r.email as string) ?? null,
        name: (r.name as string) ?? null,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        totalVisits: Number(r.total_visits) || 0,
        totalPageviews: Number(r.total_pageviews) || 0,
        totalEvents: Number(r.total_events) || 0,
        deviceCount: Number(r.device_count) || 1,
        deviceType: (r.device_type as string) ?? null,
        browser: (r.browser as string) ?? null,
        os: (r.os as string) ?? null,
        lastUtmSource: (r.last_utm_source as string) ?? null,
        lastUtmCampaign: (r.last_utm_campaign as string) ?? null,
        lastPage: (r.last_page as string) ?? null,
        lastEvent: (r.last_event as string) ?? null,
        lastEventAt: r.last_event_at,
    }));

    return NextResponse.json({
        success: true,
        data,
        page: safePage,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
    });
}
