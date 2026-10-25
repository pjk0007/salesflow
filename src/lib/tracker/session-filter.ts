import { db } from "@/lib/db";
import { trackerSessions, trackerSites } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { classifyInflow, matchesChannelFilter } from "@/components/journey/utils/referrer";
import { notExcludedExpr } from "./analytics-queries";
import { deviceFilterSql } from "./sql-filters";

/** 사이트 허용 도메인 — 유입 '직접' 판정용. 호출부가 이미 읽었으면 넘기고, 아니면 여기서 한 번 읽는다 */
async function ownDomainsOf(siteId: number, given?: readonly string[]): Promise<readonly string[]> {
    if (given) return given;
    const [site] = await db.select({ domains: trackerSites.domains }).from(trackerSites).where(eq(trackerSites.id, siteId));
    return site?.domains ?? [];
}

/**
 * 채널 필터(상위 그룹 + 광고/자연 모드)에 매칭되는 세션 ID 목록.
 * classifyInflow가 JS 함수라 SQL에서 못 처리해서 JS 후처리 방식.
 *
 * channel=null && mode="all" 이면 필터 미적용(null 반환) — 호출자는 IN 절 안 씀.
 */
export async function getSessionIdsByChannel(args: {
    siteId: number;
    fromIso: string;
    toIso: string;
    channel: string | null;          // 상위 그룹 (직접/네이버/구글/메타 광고/메일/기타) 또는 null=전체
    channelMode?: "all" | "paid" | "organic";
    /** 활성 집계 전용: 시작일 대신 기간 내 유효 PV로 세션을 선택한다. 생략 시 기존 시작일 기준. */
    activity?: { excludes: string[]; device: string | null };
    /** 사이트 허용 도메인 (없으면 siteId로 읽는다) */
    domains?: readonly string[];
}): Promise<number[] | null> {
    const mode = args.channelMode ?? "all";
    // 필터 조건이 모두 비어 있으면 적용 안 함
    if (!args.channel && mode === "all") return null;

    const rows = await db
        .select({
            id: trackerSessions.id,
            referrer: trackerSessions.referrer,
            landingPage: trackerSessions.landingPage,
        })
        .from(trackerSessions)
        .where(
            and(
                eq(trackerSessions.siteId, args.siteId),
                args.activity ? sql`EXISTS (
                    SELECT 1 FROM tracker_events ev
                    JOIN tracker_visitors tv ON tv.id = ev.visitor_id
                    WHERE ev.session_id = ${trackerSessions.id}
                      AND ev.site_id = ${args.siteId} AND tv.site_id = ${args.siteId}
                      AND ev.event_type = 'PAGE_VIEW'
                      AND ev.occurred_at >= ${args.fromIso} AND ev.occurred_at <= ${args.toIso}
                      AND ${notExcludedExpr(args.activity.excludes)}
                      ${deviceFilterSql(args.activity.device, "tv")}
                )` : and(
                    gte(trackerSessions.startedAt, new Date(args.fromIso)),
                    lte(trackerSessions.startedAt, new Date(args.toIso)),
                ),
            ),
        );

    const ownDomains = await ownDomainsOf(args.siteId, args.domains);
    return rows
        .filter((r) => matchesChannelFilter(classifyInflow(r.referrer, r.landingPage, ownDomains), args.channel, mode))
        .map((r) => r.id);
}

/**
 * 채널 필터에 매칭되는 방문자 ID 목록 — 기간 제한 없음 (방문자 탭용).
 * 방문자의 "첫 세션" referrer/utm으로 채널 분류 — overview의 visitor 채널 분류와 동일 정책.
 *
 * channel=null && mode="all" 이면 필터 미적용(null 반환).
 */
export async function getVisitorIdsByChannel(args: {
    siteId: number;
    channel: string | null;
    channelMode?: "all" | "paid" | "organic";
    domains?: readonly string[];
}): Promise<number[] | null> {
    const mode = args.channelMode ?? "all";
    if (!args.channel && mode === "all") return null;

    const rows = (await db.execute(sql`
        SELECT DISTINCT ON (visitor_id) visitor_id, referrer, landing_page
        FROM tracker_sessions
        WHERE site_id = ${args.siteId}
        ORDER BY visitor_id, started_at ASC
    `)) as unknown as Array<{
        visitor_id: number;
        referrer: string | null;
        landing_page: string | null;
    }>;

    const ownDomains = await ownDomainsOf(args.siteId, args.domains);
    return rows
        .filter((r) => matchesChannelFilter(classifyInflow(r.referrer, r.landing_page, ownDomains), args.channel, mode))
        .map((r) => r.visitor_id);
}
