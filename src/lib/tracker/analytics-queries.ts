import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { deviceFilterSql, sessionInFilterSql } from "@/lib/tracker/sql-filters";
import { pagePathExpr } from "@/lib/tracker/page-path";

/**
 * 트래커 집계 쿼리. overview·pages route의 몸통을 그대로 옮긴 것이며 웹과 MCP가 공유한다.
 * 여기서 수치가 달라지면 기존 대시보드가 조용히 틀린 값을 보여주므로,
 * route에 있던 SQL을 한 글자도 바꾸지 않았다.
 */

/** page_url에서 경로(path)만 추출하는 SQL 조각 — overview의 PATH_EXPR와 동일. */
const PATH_EXPR = sql`regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '')`;

/**
 * "제외 경로 prefix와 매칭되지 않는 page_url" 조건 (events 테이블 기준).
 * excludes가 빈 배열이면 항상 참(필터 효과 없음).
 */
export function notExcludedExpr(excludes: string[]) {
    if (excludes.length === 0) return sql`TRUE`;
    return sql`NOT (${sql.join(excludes.map((p) => sql`${PATH_EXPR} LIKE ${p + "%"}`), sql` OR `)})`;
}

/** 증감률(%). 직전이 0이면 0으로 나누지 않고 null을 낸다. */
export function pct(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return Number((((curr - prev) / prev) * 100).toFixed(1));
}

export interface AggregateRangeArgs {
    siteId: number;
    fromIso: string;
    toIso: string;
    excludes: string[];
    device: string | null;
    sessionIds: number[] | null;
}

export interface AggregateRangeResult {
    visitors: number;
    leads: number;
    sessions: number;
    bounces: number;
    avgDwell: number;
    pageviews: number;
    signups: number;
}

/**
 * 한 기간의 핵심 집계 (KPI 7종 raw + 직전기간 비교용).
 * 세그먼트 필터: device(visitor), sessionIds(channel로 거른 세션 ID, null이면 미적용)
 */
export async function aggregateRange(args: AggregateRangeArgs): Promise<AggregateRangeResult> {
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

/**
 * 사이트의 방문된 페이지 목록 — path 기준 그룹, 최신 title + 페이지뷰 수.
 *
 * range를 주지 않으면 전 기간을 본다 — 웹 pages route의 기존 동작이다.
 * MCP는 기간 조회가 필요해 optional로 열어두되, 웹은 넘기지 않아 SQL이 그대로다.
 */
export async function queryPageAnalytics(args: {
    siteId: number;
    range?: { fromIso: string; toIso: string };
    limit?: number;
}): Promise<Array<{ path: string; title: string | null; views: number }>> {
    const { siteId, range, limit = 100 } = args;
    const rangeFilter = range
        ? sql`AND occurred_at >= ${range.fromIso} AND occurred_at <= ${range.toIso}`
        : sql``;

    const rows = (await db.execute(sql`
        WITH pv AS (
            SELECT ${pagePathExpr("page_url")} AS path, page_title, occurred_at
            FROM tracker_events
            WHERE site_id = ${siteId} AND event_type = 'PAGE_VIEW' AND page_url IS NOT NULL
            ${rangeFilter}
        )
        SELECT
            path,
            (ARRAY_AGG(page_title ORDER BY occurred_at DESC)
                FILTER (WHERE page_title IS NOT NULL AND page_title <> ''))[1] AS title,
            COUNT(*)::int AS views
        FROM pv
        GROUP BY path
        ORDER BY views DESC
        LIMIT ${limit}
    `)) as unknown as Array<{ path: string; title: string | null; views: number }>;

    return rows.map((r) => ({
        path: r.path,
        title: r.title ?? null,
        views: Number(r.views) || 0,
    }));
}
