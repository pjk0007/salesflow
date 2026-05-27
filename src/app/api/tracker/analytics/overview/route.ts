import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { classifyInflow } from "@/components/journey/utils/referrer";
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

// 한 기간의 핵심 집계 (KPI 7종 raw + 직전기간 비교용).
// excludePaths가 있으면: 페이지뷰는 해당 경로 제외, 세션은 "의미있는 페이지 1+회 본" 세션만,
// 방문자/리드/가입은 "의미있는 페이지 1+회 본 visitor"만 카운트.
async function aggregateRange(siteId: number, fromIso: string, toIso: string, excludes: string[]) {
    const notExcluded = notExcludedExpr(excludes);

    // 의미있는 PV가 1+회 있는 visitor 집합 (기간 내 first_seen + 기간 내 의미있는 PV 발생)
    const meaningfulVisitorIds = sql`(
        SELECT DISTINCT tv.id
        FROM tracker_visitors tv
        JOIN tracker_events ev ON ev.visitor_id = tv.id
        WHERE tv.site_id = ${siteId}
          AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ${notExcluded}
    )`;

    const [v] = (await db.execute(sql`
        SELECT
            COUNT(*)::int AS visitors,
            COUNT(*) FILTER (WHERE record_id IS NOT NULL)::int AS leads
        FROM tracker_visitors
        WHERE id IN ${meaningfulVisitorIds}
    `)) as unknown as Array<{ visitors: number; leads: number }>;

    // 의미있는 세션: 기간 내 시작 + 그 세션 안에 의미있는 PV가 1+회. bounce = 의미있는 PV 정확히 1회.
    const [s] = (await db.execute(sql`
        WITH sess AS (
            SELECT ts.id, ts.duration,
                   (SELECT COUNT(*) FROM tracker_events ev
                    WHERE ev.session_id = ts.id AND ev.event_type = 'PAGE_VIEW'
                      AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
                      AND ${notExcluded}) AS meaningful_pv
            FROM tracker_sessions ts
            WHERE ts.site_id = ${siteId}
              AND ts.started_at >= ${fromIso} AND ts.started_at <= ${toIso}
        )
        SELECT
            COUNT(*) FILTER (WHERE meaningful_pv >= 1)::int AS sessions,
            COUNT(*) FILTER (WHERE meaningful_pv = 1)::int AS bounces,
            COALESCE(AVG(NULLIF(duration, 0)) FILTER (WHERE meaningful_pv >= 1), 0)::float AS avg_dwell
        FROM sess
    `)) as unknown as Array<{ sessions: number; bounces: number; avg_dwell: number }>;

    const [e] = (await db.execute(sql`
        SELECT COUNT(*)::int AS pageviews
        FROM tracker_events
        WHERE site_id = ${siteId} AND event_type = 'PAGE_VIEW'
          AND occurred_at >= ${fromIso} AND occurred_at <= ${toIso}
          AND ${notExcluded}
    `)) as unknown as Array<{ pageviews: number }>;

    // signup: 의미있는 visitor 중 그 record로 signup event 발생한 visitor 수
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

    try {
        const [curr, prev, daily, popular, recent, channelsRaw, devTypes, browsers, oss] = await Promise.all([
            aggregateRange(siteId, fromIso, toIso, excludes),
            aggregateRange(siteId, prevFromIso, prevToIso, excludes),
            db.execute(sql`
                SELECT occurred_at::date::text AS date, COUNT(*)::int AS count
                FROM tracker_events
                WHERE site_id = ${siteId} AND event_type = 'PAGE_VIEW'
                  AND occurred_at >= ${fromIso} AND occurred_at <= ${toIso}
                  AND ${dailyNotExcluded}
                GROUP BY 1 ORDER BY 1
            `) as Promise<unknown>,
            (async () => {
                const excludes = (site.excludePaths ?? []) as string[];
                const excludeFilter = excludes.length
                    ? sql`AND NOT (${sql.join(excludes.map((p) => sql`path LIKE ${p + "%"}`), sql` OR `)})`
                    : sql``;
                return db.execute(sql`
                    WITH paged AS (
                        SELECT
                            regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '') AS path,
                            page_title,
                            occurred_at
                        FROM tracker_events
                        WHERE site_id = ${siteId} AND event_type = 'PAGE_VIEW'
                          AND occurred_at >= ${fromIso} AND occurred_at <= ${toIso}
                          AND page_url IS NOT NULL
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
                    ORDER BY ts.visitor_id, ts.started_at DESC
                ) latest_per_visitor
                ORDER BY started_at DESC
                LIMIT 20
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT referrer, landing_page
                FROM tracker_sessions
                WHERE site_id = ${siteId}
                  AND started_at >= ${fromIso} AND started_at <= ${toIso}
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT COALESCE(device_type, 'unknown') AS name, COUNT(*)::int AS count
                FROM tracker_visitors
                WHERE site_id = ${siteId}
                  AND first_seen_at >= ${fromIso} AND first_seen_at <= ${toIso}
                GROUP BY 1 ORDER BY count DESC
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT COALESCE(browser, 'unknown') AS name, COUNT(*)::int AS count
                FROM tracker_visitors
                WHERE site_id = ${siteId}
                  AND first_seen_at >= ${fromIso} AND first_seen_at <= ${toIso}
                GROUP BY 1 ORDER BY count DESC LIMIT 5
            `) as Promise<unknown>,
            db.execute(sql`
                SELECT COALESCE(os, 'unknown') AS name, COUNT(*)::int AS count
                FROM tracker_visitors
                WHERE site_id = ${siteId}
                  AND first_seen_at >= ${fromIso} AND first_seen_at <= ${toIso}
                GROUP BY 1 ORDER BY count DESC LIMIT 5
            `) as Promise<unknown>,
        ]);

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
            recentSessions,
            inflowChannels: [...channelMap.entries()]
                .map(([channel, sessions]) => ({ channel, sessions }))
                .sort((a, b) => b.sessions - a.sessions),
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
