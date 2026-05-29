import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getSessionIdsByChannel } from "@/lib/tracker/session-filter";

/**
 * 페이지 인게이지먼트 분석.
 * 응답: pages (드롭다운용 TOP), sections, clicks.
 * 세그먼트 필터: device, channel(그룹), channelMode(all|paid|organic).
 * 페이지 필터: path prefix (예: `/pricing`). 미지정 시 사이트 전체 합산.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeBounds(fromYmd: string, toYmd: string) {
    return {
        fromIso: `${fromYmd}T00:00:00+09:00`,
        toIso: `${toYmd}T23:59:59.999+09:00`,
    };
}

function deviceFilterSql(device: string | null, alias: string) {
    return device
        ? sql.raw(`AND ${alias}.device_type = '${device.replace(/'/g, "")}'`)
        : sql``;
}

function sessionInFilterSql(ids: number[] | null, col: string) {
    if (ids === null) return sql``;
    if (ids.length === 0) return sql.raw(`AND FALSE`);
    return sql`AND ${sql.raw(col)} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
}

function pageFilterSql(page: string | null, alias: string) {
    if (!page) return sql``;
    // page_url에서 origin/queryString 제거 후 prefix 매칭
    return sql`AND regexp_replace(split_part(${sql.raw(alias)}.page_url, '?', 1), '^https?://[^/]+', '') LIKE ${page + "%"}`;
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const siteId = Number(sp.get("siteId"));
    if (!siteId) return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    // 기간
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const fromYmd = sp.get("from") ?? ymd(new Date(today.getTime() - 30 * DAY_MS));
    const toYmd = sp.get("to") ?? ymd(today);
    const { fromIso, toIso } = rangeBounds(fromYmd, toYmd);

    // 세그먼트 필터
    const deviceParam = sp.get("device");
    const device = deviceParam && ["desktop", "mobile", "tablet"].includes(deviceParam) ? deviceParam : null;
    const channel = sp.get("channel");
    const channelModeRaw = sp.get("channelMode");
    const channelMode = (["all", "paid", "organic"] as const).includes(
        channelModeRaw as "all" | "paid" | "organic",
    )
        ? (channelModeRaw as "all" | "paid" | "organic")
        : "all";
    const sessionIds = await getSessionIdsByChannel({ siteId, fromIso, toIso, channel, channelMode });

    const page = sp.get("page");
    const devFilterTv = deviceFilterSql(device, "tv");
    const sessFilterEv = sessionInFilterSql(sessionIds, "ev.session_id");
    const pageFilterEv = pageFilterSql(page, "ev");

    // 페이지 드롭다운 TOP 20 — path별 집계, title은 MAX로 대표 선택.
    const pageRows = (await db.execute(sql`
        SELECT
            regexp_replace(split_part(ev.page_url, '?', 1), '^https?://[^/]+', '') AS path,
            MAX(ev.page_title) AS title,
            COUNT(DISTINCT ev.visitor_id)::int AS pageviews
        FROM tracker_events ev
        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
        WHERE ev.site_id = ${siteId}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          ${devFilterTv}
          ${sessFilterEv}
        GROUP BY 1
        ORDER BY pageviews DESC
        LIMIT 20
    `)) as unknown as Array<{ path: string; title: string | null; pageviews: number }>;

    // 페이지 필터 적용된 PV 분모 — 시인율/클릭율 계산용
    const [pvDenominator] = (await db.execute(sql`
        SELECT COUNT(DISTINCT ev.visitor_id)::int AS visitors
        FROM tracker_events ev
        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
        WHERE ev.site_id = ${siteId}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          ${devFilterTv}
          ${sessFilterEv}
          ${pageFilterEv}
    `)) as unknown as Array<{ visitors: number }>;
    const totalVisitors = Math.max(1, pvDenominator?.visitors ?? 0);

    // sections — tracker_event_aliases LEFT JOIN으로 label 함께 가져옴
    const sectionRows = (await db.execute(sql`
        SELECT
            ev.event_name AS name,
            a.label AS label,
            COUNT(DISTINCT ev.visitor_id)::int AS visitors,
            COUNT(*)::int AS pageviews,
            COALESCE(AVG((ev.properties->>'dwell_ms')::numeric), 0)::int AS "avgDwellMs"
        FROM tracker_events ev
        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
        LEFT JOIN tracker_event_aliases a
            ON a.site_id = ev.site_id
           AND a.event_type = 'SECTION_VIEW'
           AND a.event_name = ev.event_name
        WHERE ev.site_id = ${siteId}
          AND ev.event_type = 'SECTION_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ev.event_name IS NOT NULL
          -- 진짜 "본" 섹션만 — 1초 이상 머문 이벤트만 (GA4/GTM 표준)
          AND (ev.properties->>'dwell_ms')::numeric >= 1000
          ${devFilterTv}
          ${sessFilterEv}
          ${pageFilterEv}
        GROUP BY ev.event_name, a.label
        ORDER BY visitors DESC
        LIMIT 50
    `)) as unknown as Array<{ name: string; label: string | null; visitors: number; pageviews: number; avgDwellMs: number }>;

    const sections = sectionRows.map((r) => ({
        name: r.name,
        label: r.label,
        visitors: r.visitors,
        pageviews: r.pageviews,
        avgDwellMs: r.avgDwellMs,
        viewRate: r.visitors / totalVisitors,
    }));

    // clicks — section은 properties.section 중 최빈값, label은 alias LEFT JOIN
    const clickRows = (await db.execute(sql`
        SELECT
            ev.event_name AS name,
            a.label AS label,
            (SELECT ev2.properties->>'section'
               FROM tracker_events ev2
              WHERE ev2.site_id = ${siteId}
                AND ev2.event_type = 'CLICK'
                AND ev2.event_name = ev.event_name
                AND ev2.occurred_at >= ${fromIso} AND ev2.occurred_at <= ${toIso}
                AND ev2.properties->>'section' IS NOT NULL
              GROUP BY ev2.properties->>'section'
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS section,
            COUNT(*)::int AS clicks,
            COUNT(DISTINCT ev.visitor_id)::int AS visitors
        FROM tracker_events ev
        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
        LEFT JOIN tracker_event_aliases a
            ON a.site_id = ev.site_id
           AND a.event_type = 'CLICK'
           AND a.event_name = ev.event_name
        WHERE ev.site_id = ${siteId}
          AND ev.event_type = 'CLICK'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ev.event_name IS NOT NULL
          ${devFilterTv}
          ${sessFilterEv}
          ${pageFilterEv}
        GROUP BY ev.event_name, a.label
        ORDER BY clicks DESC
        LIMIT 50
    `)) as unknown as Array<{ name: string; label: string | null; section: string | null; clicks: number; visitors: number }>;

    const clicks = clickRows.map((r) => ({
        name: r.name,
        label: r.label,
        section: r.section,
        clicks: r.clicks,
        visitors: r.visitors,
        clickRate: r.visitors / totalVisitors,
    }));

    return NextResponse.json({
        success: true,
        data: {
            range: { from: fromYmd, to: toYmd },
            page,
            pages: pageRows,
            sections,
            clicks,
        },
    });
}
