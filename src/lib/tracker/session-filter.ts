import { db } from "@/lib/db";
import { trackerSessions } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { classifyInflow } from "@/components/journey/utils/referrer";

/**
 * 채널 필터에 매칭되는 세션 ID 목록을 구한다.
 * classifyInflow가 JS 함수라 SQL에서 못 처리해서 JS 후처리 방식.
 * 운영 규모(sessions 수천)는 OK. 큰 데이터면 traffic_source 컬럼 채워 SQL 이전 검토.
 *
 * channel이 null이면 null 반환 (필터 미적용 — 호출자는 IN 절 안 씀).
 */
export async function getSessionIdsByChannel(args: {
    siteId: number;
    fromIso: string;
    toIso: string;
    channel: string | null;
}): Promise<number[] | null> {
    if (!args.channel) return null;

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
        .filter((r) => classifyInflow(r.referrer, r.landingPage) === args.channel)
        .map((r) => r.id);
}
