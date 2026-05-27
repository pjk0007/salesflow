import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { classifyInflow } from "@/components/journey/utils/referrer";
import { getSessionIdsByChannel } from "@/lib/tracker/session-filter";
import type { OverviewData } from "@/components/tracker/types/overview";

const DAY_MS = 24 * 60 * 60 * 1000;

// KST 자정 기준 from/to ISO 변환 (입력 YYYY-MM-DD).
function rangeBounds(fromYmd: string, toYmd: string): { fromIso: string; toIso: string } {
    return {
        fromIso: `${fromYmd}T00:00:00+09:00`,
        toIso: `${toYmd}T23:59:59.999+09:00`,
    };
}

// url에서 host 제거 + ? 이전 경로
function normalizePath(url: string): string {
    return url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";
}

function pct(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
}

// page_url에서 경로(path)만 추출하는 SQL 조각
const PATH_EXPR = sql`regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '')`;

// "제외 경로 prefix와 매칭되지 않는 page_url" 조건 (events 테이블 기준).
// excludes가 빈 배열이면 항상 참(필터 효과 없음).
function notExcludedExpr(excludes: string[]) {
    if (excludes.length === 0) return sql`TRUE`;
    return sql`NOT (${sql.join(excludes.map((p) => sql`${PATH_EXPR} LIKE ${p + "%"}`), sql` OR `)})`;
}

// 세그먼트 필터 SQL 조각 — device(visitor.device_type) + sessionIds(channel 필터 결과)
function deviceFilterSql(device: string | null, visitorAlias = "tv") {
    return device ? sql.raw(`AND ${visitorAlias}.device_type = '${device.replace(/'/g, "")}'`) : sql``;
}
function sessionInFilterSql(sessionIds: number[] | null, sessionCol: string) {
    if (sessionIds === null) return sql``;
    if (sessionIds.length === 0) return sql.raw(`AND FALSE`); // 채널 매칭 0 → 모두 제외
    return sql`AND ${sql.raw(sessionCol)} IN (${sql.join(sessionIds.map((id) => sql`${id}`), sql`, `)})`;
}

// 한 기간의 핵심 집계 (KPI 7종 raw + 직전기간 비교용).
// 세그먼트 필터: device(visitor), sessionIds(channel로 거른 세션 ID, null이면 미적용)
async function aggregateRange(args: {
    siteId: number;
    fromIso: string;
    toIso: string;
    excludes: string[];
    device: string | null;
    sessionIds: number[] | null;
}) {
    const { siteId, fromIso, toIso, excludes, device, sessionIds } = args;
    const notExcluded = notExcludedExpr(excludes);
    const devFilterTv = deviceFilterSql(device, "tv");
    const sessFilterEv = sessionInFilterSql(sessionIds, "ev.session_id");
    const sessFilterTs = sessionInFilterSql(sessionIds, "ts.id");

    // 의미있는 PV가 1+회 있는 visitor 집합
    const meaningfulVisitorIds = sql`(
        SELECT DISTINCT tv.id
        FROM tracker_visitors tv
        JOIN tracker_events ev ON ev.visitor_id = tv.id
        WHERE tv.site_id = ${siteId}
          AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ${notExcluded}
          ${devFilterTv}
          ${sessFilterEv}
    )`;

    const [v] = (await db.execute(sql`
        SELECT
            COUNT(*)::int AS visitors,
            COUNT(*) FILTER (WHERE record_id IS NOT NULL)::int AS leads
        FROM tracker_visitors tv
        WHERE id IN ${meaningfulVisitorIds}
    `)) as unknown as Array<{ visitors: number; leads: number }>;

    // 의미있는 세션. device 필터는 세션의 visitor를 JOIN해 적용.
    const [s] = (await db.execute(sql`
        WITH sess AS (
            SELECT ts.id, ts.duration,
                   (SELECT COUNT(*) FROM tracker_events ev
                    WHERE ev.session_id = ts.id AND ev.event_type = 'PAGE_VIEW'
                      AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                      AND ${notExcluded}) AS meaningful_pv
            FROM tracker_sessions ts
            JOIN tracker_visitors tv ON tv.id = ts.visitor_id
            WHERE ts.site_id = ${siteId}
              AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
              ${devFilterTv}
              ${sessFilterTs}
        )
        SELECT
            COUNT(*) FILTER (WHERE meaningful_pv >= 1)::int AS sessions,
            COUNT(*) FILTER (WHERE meaningful_pv = 1)::int AS bounces,
            COALESCE(AVG(NULLIF(duration, 0)) FILTER (WHERE meaningful_pv >= 1), 0)::float AS avg_dwell
        FROM sess
    `)) as unknown as Array<{ sessions: number; bounces: number; avg_dwell: number }>;

    const [e] = (await db.execute(sql`
        SELECT COUNT(*)::int AS pageviews
        FROM tracker_events ev
        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
        WHERE ev.site_id = ${siteId} AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ${notExcluded}
          ${devFilterTv}
          ${sessFilterEv}
    `)) as unknown as Array<{ pageviews: number }>;

    const [g] = (await db.execute(sql`
        SELECT COUNT(DISTINCT tv.id)::int AS signups
        FROM tracker_visitors tv
        JOIN record_events re ON re.record_id = tv.record_id AND re.type = 'signup'
        WHERE tv.id IN ${meaningfulVisitorIds}
          AND re.occurred_at >= ${fromIso} AND re.occurred_at <= ${toIso}
    `)) as unknown as Array<{ signups: number }>;

    return {
        visitors: v.visitors,
        leads: v.leads,
        sessions: s.sessions,
        bounces: s.bounces,
        avgDwell: Math.round(s.avg_dwell),
        pageviews: e.pageviews,
        signups: g.signups,
    };
}

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

    // 사이트 격리 (org 단위)
    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    // 기간 (기본 30일)
    const today = new Date();
    const defaultFromDate = new Date(today.getTime() - 30 * DAY_MS);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const fromYmd = sp.get("from") ?? ymd(defaultFromDate);
    const toYmd = sp.get("to") ?? ymd(today);
    const { fromIso, toIso } = rangeBounds(fromYmd, toYmd);

    // 직전 동일 길이 기간
    const fromDate = new Date(`${fromYmd}T00:00:00+09:00`);
    const toDate = new Date(`${toYmd}T23:59:59+09:00`);
    const lengthDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS));
    const prevFrom = new Date(fromDate.getTime() - lengthDays * DAY_MS);
    const prevTo = new Date(fromDate.getTime() - 1);
    const { fromIso: prevFromIso, toIso: prevToIso } = rangeBounds(ymd(prevFrom), ymd(prevTo));

    const excludes = (site.excludePaths ?? []) as string[];
    const dailyNotExcluded = notExcludedExpr(excludes);

    // 세그먼트 필터 파싱
    const deviceParam = sp.get("device");
    const device = deviceParam && ["desktop", "mobile", "tablet"].includes(deviceParam) ? deviceParam : null;
    const channel = sp.get("channel");

    try {
        // 채널 필터 있으면 매칭 세션 ID 사전 추출 (현재/직전 기간 각각)
        const [sessionIdsCurr, sessionIdsPrev] = await Promise.all([
            getSessionIdsByChannel({ siteId, fromIso, toIso, channel }),
            getSessionIdsByChannel({ siteId, fromIso: prevFromIso, toIso: prevToIso, channel }),
        ]);

        const devFilterTv = deviceFilterSql(device, "tv");
        const sessFilterTs = sessionInFilterSql(sessionIdsCurr, "ts.id");
        const sessFilterEv = sessionInFilterSql(sessionIdsCurr, "ev.session_id");

        const [curr, prev, daily, channelConv, dailyConv, popular, exitsRows, recent, channelsRaw, adContentsRows, devTypes, browsers, oss] = await Promise.all([
            aggregateRange({ siteId, fromIso, toIso, excludes, device, sessionIds: sessionIdsCurr }),
            aggregateRange({ siteId, fromIso: prevFromIso, toIso: prevToIso, excludes, device, sessionIds: sessionIdsPrev }),
            // 일별 페이지뷰
            db.execute(sql`
                SELECT occurred_at::date::text AS date, COUNT(*)::int AS count
                FROM tracker_events ev
                JOIN tracker_visitors tv ON tv.id = ev.visitor_id
                WHERE ev.site_id = ${siteId} AND ev.event_type = 'PAGE_VIEW'
                  AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                  AND ${dailyNotExcluded}
                  ${devFilterTv}
                  ${sessFilterEv}
                GROUP BY 1 ORDER BY 1
            `) as Promise<unknown>,
            // 채널별 전환: SQL로 채널 분류 (classifyInflow와 정책 일치) + visitor / lead 카운트
            db.execute(sql`
                WITH visitor_channel AS (
                    SELECT
                        tv.id AS visitor_id,
                        tv.record_id IS NOT NULL AS is_lead,
                        -- 그 visitor의 첫 세션 utm/referrer로 채널 분류
                        (SELECT
                            CASE
                                -- 광고 (식별자 있거나 medium=cpc/paid/pmax)
                                WHEN s.landing_page LIKE '%fbclid=%' OR (lower(s.utm_source) IN ('meta','facebook','instagram') AND lower(s.utm_medium) IN ('cpc','paid','paid_social')) THEN '메타 광고'
                                WHEN lower(s.utm_source)='google' AND lower(s.utm_medium) IN ('cpc','paid','pmax') THEN '구글 검색광고'
                                WHEN lower(s.utm_source)='naver' AND lower(s.utm_medium) IN ('cpc','paid') THEN '네이버 검색광고'
                                -- 메일
                                WHEN lower(s.utm_source)='email' OR lower(s.utm_medium) IN ('email','sales') OR s.landing_page LIKE '%sendb_cid%' THEN '메일'
                                -- 소셜 (organic): medium=social이면 utm_source를 채널명으로 그대로
                                WHEN lower(s.utm_medium) IN ('social','social-organic','organic_social') AND s.utm_source IS NOT NULL AND s.utm_source <> ''
                                    THEN INITCAP(s.utm_source)
                                -- utm 없거나 source만 있는 경우 referrer 기반 보강
                                WHEN s.referrer ~* 'search\.naver\.com' OR lower(s.utm_source)='naver' THEN '네이버 검색'
                                WHEN s.referrer ~* 'google\.com' OR lower(s.utm_source)='google' THEN '구글 검색'
                                WHEN s.referrer ~* 'bing\.com|duckduckgo|daum\.net' THEN '검색'
                                WHEN s.referrer ~* 'threads\.com' THEN 'Threads'
                                WHEN s.referrer ~* 'instagram\.com' THEN 'Instagram'
                                WHEN s.referrer ~* 'facebook\.com|fb\.com' THEN 'Facebook'
                                WHEN s.referrer ~* 'twitter\.com|x\.com|t\.co' THEN 'X'
                                -- 자체 도메인 referrer = 직접 (사이트 내부 클릭/재방문)
                                WHEN s.referrer ~* 'designer-hire\.com|backofficelab\.com|pixelandlogic\.com|localhost' THEN '직접'
                                -- referrer 없음 = 직접 진입
                                WHEN s.referrer IS NULL OR s.referrer = '' THEN '직접'
                                ELSE '기타'
                            END
                            FROM tracker_sessions s
                            WHERE s.visitor_id = tv.id AND s.site_id = ${siteId}
                            ORDER BY s.started_at ASC LIMIT 1
                        ) AS channel
                    FROM tracker_visitors tv
                    WHERE tv.site_id = ${siteId}
                      AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
                      AND EXISTS (
                          SELECT 1 FROM tracker_events ev2
                          WHERE ev2.visitor_id = tv.id AND ev2.event_type = 'PAGE_VIEW'
                            AND ev2.occurred_at >= ${fromIso} AND ev2.occurred_at <= ${toIso}
                            AND ${dailyNotExcluded}
                            ${sessFilterEv}
                      )
                      ${devFilterTv}
                )
                SELECT channel,
                       COUNT(*)::int AS visitors,
                       COUNT(*) FILTER (WHERE is_lead)::int AS leads
                FROM visitor_channel
                WHERE channel IS NOT NULL
                GROUP BY channel
                ORDER BY visitors DESC
            `) as Promise<unknown>,
            // 일별 가입/구독 추이 — record_events 기반 (signup + match_stage=conversionStage)
            db.execute(sql`
                SELECT
                    re.occurred_at::date::text AS date,
                    COUNT(DISTINCT re.record_id) FILTER (WHERE re.type = 'signup')::int AS signups,
                    COUNT(DISTINCT re.record_id) FILTER (
                        WHERE re.type = 'match_stage' AND re.label = ${site.conversionStage ?? ""}
                    )::int AS paid
                FROM record_events re
                JOIN tracker_visitors tv ON tv.record_id = re.record_id
                WHERE tv.site_id = ${siteId}
                  AND re.occurred_at >= ${fromIso} AND re.occurred_at <= ${toIso}
                  AND (re.type = 'signup' OR re.type = 'match_stage')
                GROUP BY 1
                ORDER BY 1
            `) as Promise<unknown>,
            // 인기 페이지 TOP10
            (async () => {
                const excludeFilter = excludes.length
                    ? sql`AND NOT (${sql.join(excludes.map((p) => sql`path LIKE ${p + "%"}`), sql` OR `)})`
                    : sql``;
                return db.execute(sql`
                    WITH paged AS (
                        SELECT
                            regexp_replace(split_part(ev.page_url, '?', 1), '^https?://[^/]+', '') AS path,
                            ev.page_title,
                            ev.occurred_at
                        FROM tracker_events ev
                        JOIN tracker_visitors tv ON tv.id = ev.visitor_id
                        WHERE ev.site_id = ${siteId} AND ev.event_type = 'PAGE_VIEW'
                          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                          AND ev.page_url IS NOT NULL
                          ${devFilterTv}
                          ${sessFilterEv}
                    )
                    SELECT path,
                           (ARRAY_AGG(page_title ORDER BY occurred_at DESC))[1] AS title,
                           COUNT(*)::int AS views
                    FROM paged
                    WHERE 1=1 ${excludeFilter}
                    GROUP BY path
                    ORDER BY views DESC
                    LIMIT 10
                `);
            })() as Promise<unknown>,
            // 이탈 페이지 TOP10 — bounce 제외, exit_page NULL이면 마지막 PAGE_VIEW fallback
            (async () => {
                const excludeFilter = excludes.length
                    ? sql`AND NOT (${sql.join(excludes.map((p) => sql`path LIKE ${p + "%"}`), sql` OR `)})`
                    : sql``;
                return db.execute(sql`
                    WITH meaningful_pv_per_session AS (
                        -- 의미있는 PV(excludes 제외) 카운트
                        SELECT ev.session_id, COUNT(*)::int AS pv_count
                        FROM tracker_events ev
                        WHERE ev.event_type = 'PAGE_VIEW'
                          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                          AND ${notExcludedExpr(excludes)}
                        GROUP BY ev.session_id
                    ),
                    last_pv_per_session AS (
                        -- 세션별 마지막 PAGE_VIEW (exit_page NULL 대비 fallback)
                        SELECT DISTINCT ON (ev.session_id)
                            ev.session_id, ev.page_url, ev.page_title
                        FROM tracker_events ev
                        WHERE ev.event_type = 'PAGE_VIEW'
                          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                          AND ev.page_url IS NOT NULL
                        ORDER BY ev.session_id, ev.occurred_at DESC
                    ),
                    filtered_sess AS (
                        SELECT ts.id, ts.exit_page,
                               lp.page_url AS last_pv_url,
                               lp.page_title AS last_pv_title,
                               m.pv_count
                        FROM tracker_sessions ts
                        JOIN tracker_visitors tv ON tv.id = ts.visitor_id
                        JOIN meaningful_pv_per_session m ON m.session_id = ts.id
                        LEFT JOIN last_pv_per_session lp ON lp.session_id = ts.id
                        WHERE ts.site_id = ${siteId}
                          AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
                          AND m.pv_count >= 2
                          ${devFilterTv}
                          ${sessFilterTs}
                    )
                    , exit_paths AS (
                        SELECT
                            regexp_replace(split_part(COALESCE(NULLIF(exit_page, ''), last_pv_url), '?', 1), '^https?://[^/]+', '') AS path,
                            last_pv_title
                        FROM filtered_sess
                        WHERE COALESCE(NULLIF(exit_page, ''), last_pv_url) IS NOT NULL
                    )
                    SELECT path,
                           (ARRAY_AGG(last_pv_title))[1] AS title,
                           COUNT(*)::int AS exits
                    FROM exit_paths
                    WHERE path <> '' ${excludeFilter}
                    GROUP BY path
                    ORDER BY exits DESC
                    LIMIT 10
                `);
            })() as Promise<unknown>,
            // 최근 활성 방문자 (visitor당 1건)
            db.execute(sql`
                SELECT id, visitor_pk, anon_id, email, landing_page, referrer, page_count, started_at
                FROM (
                    SELECT DISTINCT ON (ts.visitor_id)
                        ts.id, ts.visitor_id AS visitor_pk, tv.visitor_id AS anon_id, tv.email,
                        ts.landing_page, ts.referrer, ts.page_count, ts.started_at
                    FROM tracker_sessions ts
                    JOIN tracker_visitors tv ON tv.id = ts.visitor_id
                    WHERE ts.site_id = ${siteId}
                      AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
                      ${devFilterTv}
                      ${sessFilterTs}
                    ORDER BY ts.visitor_id, ts.started_at DESC
                ) latest_per_visitor
                ORDER BY started_at DESC
                LIMIT 20
            `) as Promise<unknown>,
            // 유입 채널 분포 raw
            db.execute(sql`
                SELECT ts.referrer, ts.landing_page
                FROM tracker_sessions ts
                JOIN tracker_visitors tv ON tv.id = ts.visitor_id
                WHERE ts.site_id = ${siteId}
                  AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
                  ${devFilterTv}
                  ${sessFilterTs}
            `) as Promise<unknown>,
            // 광고 소재 TOP — 소재명 / 세션수 / 리드율 / 대표 출처(source/medium/campaign)
            db.execute(sql`
                SELECT
                    ts.utm_content AS content,
                    COUNT(DISTINCT ts.id)::int AS sessions,
                    COUNT(DISTINCT ts.visitor_id) FILTER (WHERE tv.record_id IS NOT NULL)::int AS leads,
                    (mode() WITHIN GROUP (ORDER BY ts.utm_source))   AS top_source,
                    (mode() WITHIN GROUP (ORDER BY ts.utm_medium))   AS top_medium,
                    (mode() WITHIN GROUP (ORDER BY ts.utm_campaign)) AS top_campaign
                FROM tracker_sessions ts
                JOIN tracker_visitors tv ON tv.id = ts.visitor_id
                WHERE ts.site_id = ${siteId}
                  AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
                  AND ts.utm_content IS NOT NULL AND ts.utm_content <> ''
                  ${devFilterTv}
                  ${sessFilterTs}
                GROUP BY 1
                ORDER BY sessions DESC
                LIMIT 10
            `) as Promise<unknown>,
            // 디바이스/브라우저/OS 분포 — visitor의 의미있는 활동 + 세그먼트 필터 적용
            db.execute(sql`
                SELECT COALESCE(tv.device_type, 'unknown') AS name, COUNT(DISTINCT tv.id)::int AS count
                FROM tracker_visitors tv
                JOIN tracker_events ev ON ev.visitor_id = tv.id
                WHERE tv.site_id = ${siteId}
                  AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
                  AND ev.event_type = 'PAGE_VIEW'
                  AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                  AND ${dailyNotExcluded}
                  ${devFilterTv}
                  ${sessFilterEv}
                GROUP BY 1 ORDER BY count DESC
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT COALESCE(tv.browser, 'unknown') AS name, COUNT(DISTINCT tv.id)::int AS count
                FROM tracker_visitors tv
                JOIN tracker_events ev ON ev.visitor_id = tv.id
                WHERE tv.site_id = ${siteId}
                  AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
                  AND ev.event_type = 'PAGE_VIEW'
                  AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                  AND ${dailyNotExcluded}
                  ${devFilterTv}
                  ${sessFilterEv}
                GROUP BY 1 ORDER BY count DESC LIMIT 5
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT COALESCE(tv.os, 'unknown') AS name, COUNT(DISTINCT tv.id)::int AS count
                FROM tracker_visitors tv
                JOIN tracker_events ev ON ev.visitor_id = tv.id
                WHERE tv.site_id = ${siteId}
                  AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
                  AND ev.event_type = 'PAGE_VIEW'
                  AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                  AND ${dailyNotExcluded}
                  ${devFilterTv}
                  ${sessFilterEv}
                GROUP BY 1 ORDER BY count DESC LIMIT 5
            `) as Promise<unknown>,
        ]);

        // 전환 완료(결제) 단계 카운트 — site.conversionStage가 있을 때만.
        // "기간 내 의미있는 visitor" 중 그 record의 matchStep이 **기간 내에** conversionStage로
        // 바뀐(또는 첫 도달한) visitor 수. record_events의 match_stage 이벤트 기반으로 시점 정확.
        let paidCount: number | null = null;
        if (site.conversionStage) {
            const devFilterTv2 = deviceFilterSql(device, "tv");
            const sessFilterEv2 = sessionInFilterSql(sessionIdsCurr, "ev.session_id");
            const notExcludedExpr2 = notExcludedExpr(excludes);
            const [p] = (await db.execute(sql`
                SELECT COUNT(DISTINCT tv.id)::int AS paid
                FROM tracker_visitors tv
                JOIN record_events re ON re.record_id = tv.record_id
                  AND re.type = 'match_stage'
                  AND re.label = ${site.conversionStage}
                  AND re.occurred_at >= ${fromIso} AND re.occurred_at <= ${toIso}
                WHERE tv.site_id = ${siteId}
                  AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
                  AND EXISTS (
                    SELECT 1 FROM tracker_events ev
                    WHERE ev.visitor_id = tv.id AND ev.event_type = 'PAGE_VIEW'
                      AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                      AND ${notExcludedExpr2}
                      ${sessFilterEv2}
                  )
                  ${devFilterTv2}
            `)) as unknown as Array<{ paid: number }>;
            paidCount = p?.paid ?? 0;
        }

        // 유입 채널은 JS로 분류 후 집계
        const channelMap = new Map<string, number>();
        for (const row of (channelsRaw as Array<{ referrer: string | null; landing_page: string | null }>)) {
            const ch = classifyInflow(row.referrer, row.landing_page);
            channelMap.set(ch, (channelMap.get(ch) ?? 0) + 1);
        }

        const recentSessions = (recent as Array<{
            id: number; visitor_pk: number; anon_id: string; email: string | null;
            landing_page: string | null; referrer: string | null; page_count: number; started_at: string;
        }>).map((r) => ({
            id: r.id,
            visitorId: r.visitor_pk,
            visitorEmail: r.email,
            visitorAnonId: String(r.anon_id ?? "").slice(0, 8),
            landingPath: r.landing_page ? normalizePath(r.landing_page) : null,
            channel: classifyInflow(r.referrer, r.landing_page),
            pageCount: r.page_count,
            startedAt: new Date(r.started_at).toISOString(),
        }));

        const data: OverviewData = {
            range: { from: fromYmd, to: toYmd },
            kpi: {
                visitors: { value: curr.visitors, deltaPct: pct(curr.visitors, prev.visitors) },
                sessions: { value: curr.sessions, deltaPct: pct(curr.sessions, prev.sessions) },
                pageviews: { value: curr.pageviews, deltaPct: pct(curr.pageviews, prev.pageviews) },
                avgDwellSec: { value: curr.avgDwell, deltaPct: pct(curr.avgDwell, prev.avgDwell) },
                bounceRate: {
                    value: curr.sessions > 0 ? Number((curr.bounces / curr.sessions).toFixed(3)) : 0,
                    deltaPct: pct(
                        curr.sessions ? curr.bounces / curr.sessions : 0,
                        prev.sessions ? prev.bounces / prev.sessions : 0,
                    ),
                },
                leadRate: {
                    value: curr.visitors > 0 ? Number((curr.leads / curr.visitors).toFixed(3)) : 0,
                    deltaPct: pct(
                        curr.visitors ? curr.leads / curr.visitors : 0,
                        prev.visitors ? prev.leads / prev.visitors : 0,
                    ),
                },
                signupRate: {
                    value: curr.visitors > 0 ? Number((curr.signups / curr.visitors).toFixed(3)) : 0,
                    deltaPct: pct(
                        curr.visitors ? curr.signups / curr.visitors : 0,
                        prev.visitors ? prev.signups / prev.visitors : 0,
                    ),
                },
            },
            dailyPageviews: (daily as Array<{ date: string; count: number }>),
            popularPages: (popular as Array<{ path: string; title: string | null; views: number }>),
            exitPages: (exitsRows as Array<{ path: string; title: string | null; exits: number }>),
            recentSessions,
            inflowChannels: [...channelMap.entries()]
                .map(([channel, sessions]) => ({ channel, sessions }))
                .sort((a, b) => b.sessions - a.sessions),
            channelConversions: (channelConv as Array<{ channel: string; visitors: number; leads: number }>)
                .map((r) => ({
                    channel: r.channel,
                    visitors: r.visitors,
                    leads: r.leads,
                    leadRate: r.visitors > 0 ? Number(((r.leads / r.visitors) * 100).toFixed(1)) : 0,
                })),
            dailyConversions: (dailyConv as Array<{ date: string; signups: number; paid: number }>),
            funnel: {
                visitors: curr.visitors,
                leads: curr.leads,
                signups: curr.signups,
                paid: paidCount,
                conversionStageLabel: site.conversionStage,
            },
            adContents: (adContentsRows as Array<{
                content: string; sessions: number; leads: number;
                top_source: string | null; top_medium: string | null; top_campaign: string | null;
            }>).map((r) => ({
                content: r.content,
                sessions: r.sessions,
                leads: r.leads,
                leadRate: r.sessions > 0 ? Number(((r.leads / r.sessions) * 100).toFixed(1)) : 0,
                source: r.top_source,
                medium: r.top_medium,
                campaign: r.top_campaign,
            })),
            devices: {
                types: devTypes as Array<{ name: string; count: number }>,
                browsers: browsers as Array<{ name: string; count: number }>,
                oss: oss as Array<{ name: string; count: number }>,
            },
        };

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Tracker overview error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
