import { db } from "@/lib/db";
import { trackerSessions } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { classifyInflow, matchesChannelFilter } from "@/components/journey/utils/referrer";

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
                gte(trackerSessions.startedAt, new Date(args.fromIso)),
                lte(trackerSessions.startedAt, new Date(args.toIso)),
            ),
        );

    return rows
        .filter((r) => matchesChannelFilter(classifyInflow(r.referrer, r.landingPage), args.channel, mode))
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

    return rows
        .filter((r) => matchesChannelFilter(classifyInflow(r.referrer, r.landing_page), args.channel, mode))
        .map((r) => r.visitor_id);
}
