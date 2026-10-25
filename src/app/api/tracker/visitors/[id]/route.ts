import { NextRequest, NextResponse } from "next/server";
import {
    db,
    trackerSessions,
    trackerEvents,
    trackerEventAliases,
} from "@/lib/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import {
    VISITOR_SESSION_LIMIT,
    labelVisitorEngagement,
    loadLatestSessionEvents,
    loadTotalDuration,
    loadVisitorGroup,
} from "@/lib/tracker/visitor-detail";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const visitorPk = Number(id);
    if (!visitorPk) {
        return NextResponse.json({ success: false, error: "잘못된 ID" }, { status: 400 });
    }

    const access = await loadVisitorGroup(visitorPk, user.orgId);
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    // record로 식별된 사람이면 같은 record의 모든 visitor를 묶어서 본다
    const { visitor, group: groupVisitors } = access;
    const visitorIds = groupVisitors.map((v) => v.id);

    const sessions = await db
        .select()
        .from(trackerSessions)
        .where(inArray(trackerSessions.visitorId, visitorIds))
        .orderBy(desc(trackerSessions.startedAt), desc(trackerSessions.id))
        .limit(VISITOR_SESSION_LIMIT);

    // 세션 타임라인용 — 세션마다 최신 이벤트(시간순)와 세션별 전체 이벤트 수
    const { events, sessionTotals: sessionEventTotals } = await loadLatestSessionEvents(sessions.map((s) => s.id));

    // 관심도 집계 (전체 기간, 이벤트 limit 무관)
    const [sectionRows, clickRows, pageRows, dailyRows, hourlyRows, aliasRows, totalDuration] = await Promise.all([
        db
            .select({
                name: trackerEvents.eventName,
                dwellMs: sql<number>`COALESCE(SUM((${trackerEvents.properties}->>'dwell_ms')::numeric), 0)::int`,
                views: sql<number>`COUNT(*)::int`,
            })
            .from(trackerEvents)
            .where(and(inArray(trackerEvents.visitorId, visitorIds), eq(trackerEvents.eventType, "SECTION_VIEW")))
            .groupBy(trackerEvents.eventName)
            .orderBy(desc(sql`SUM((${trackerEvents.properties}->>'dwell_ms')::numeric)`))
            .limit(8),
        db
            .select({
                name: trackerEvents.eventName,
                count: sql<number>`COUNT(*)::int`,
                text: sql<string | null>`MAX(${trackerEvents.properties}->>'text')`,
                href: sql<string | null>`MAX(${trackerEvents.properties}->>'href')`,
            })
            .from(trackerEvents)
            .where(and(inArray(trackerEvents.visitorId, visitorIds), eq(trackerEvents.eventType, "CLICK")))
            .groupBy(trackerEvents.eventName)
            .orderBy(desc(sql`COUNT(*)`))
            .limit(8),
        db
            .select({
                url: trackerEvents.pageUrl,
                title: sql<string | null>`MAX(${trackerEvents.pageTitle})`,
                views: sql<number>`COUNT(*)::int`,
            })
            .from(trackerEvents)
            .where(and(inArray(trackerEvents.visitorId, visitorIds), eq(trackerEvents.eventType, "PAGE_VIEW")))
            .groupBy(trackerEvents.pageUrl)
            .orderBy(desc(sql`COUNT(*)`))
            .limit(8),
        db
            .select({
                date: sql<string>`(${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')::date::text`,
                count: sql<number>`COUNT(*)::int`,
            })
            .from(trackerEvents)
            .where(inArray(trackerEvents.visitorId, visitorIds))
            .groupBy(sql`(${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')::date`)
            .orderBy(sql`(${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')::date`),
        db
            .select({
                hour: sql<number>`EXTRACT(HOUR FROM ${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')::int`,
                count: sql<number>`COUNT(*)::int`,
            })
            .from(trackerEvents)
            .where(inArray(trackerEvents.visitorId, visitorIds))
            .groupBy(sql`EXTRACT(HOUR FROM ${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')`)
            .orderBy(sql`EXTRACT(HOUR FROM ${trackerEvents.occurredAt} AT TIME ZONE 'Asia/Seoul')`),
        db
            .select({
                eventType: trackerEventAliases.eventType,
                eventName: trackerEventAliases.eventName,
                label: trackerEventAliases.label,
            })
            .from(trackerEventAliases)
            .where(eq(trackerEventAliases.siteId, visitor.siteId)),
        loadTotalDuration(visitorIds),
    ]);

    // 별칭 라벨 머지 (섹션/클릭 이름 → 사람이 읽는 라벨, 빈 라벨은 원래 이름)
    const labeled = labelVisitorEngagement(sectionRows, clickRows, aliasRows);
    const engagement = {
        sections: labeled.sections,
        clicks: labeled.clicks,
        pages: pageRows.filter((r) => r.url).map((r) => ({ ...r, url: r.url! })),
    };

    // 그룹 합산 요약 — 체류시간도 방문수·페이지뷰처럼 전체 세션 합계
    const summary = {
        totalDuration,
        totalVisits: groupVisitors.reduce((s, v) => s + v.totalVisits, 0),
        totalPageviews: groupVisitors.reduce((s, v) => s + v.totalPageviews, 0),
        totalEvents: groupVisitors.reduce((s, v) => s + v.totalEvents, 0),
        deviceCount: groupVisitors.length,
        firstSeenAt: groupVisitors.reduce<Date | null>(
            (min, v) => (!min || v.firstSeenAt < min ? v.firstSeenAt : min),
            null,
        ),
        lastSeenAt: groupVisitors.reduce<Date | null>(
            (max, v) => (!max || v.lastSeenAt > max ? v.lastSeenAt : max),
            null,
        ),
        devices: groupVisitors.map((v) => ({
            id: v.id,
            visitorId: v.visitorId,
            deviceType: v.deviceType,
            browser: v.browser,
            os: v.os,
            lastSeenAt: v.lastSeenAt,
        })),
    };

    // 타임라인에서 이벤트명 → 라벨 치환용 ("TYPE:name" 키)
    const aliases = labeled.aliases;

    return NextResponse.json({
        success: true,
        data: {
            visitor,
            summary,
            sessions,
            events,
            sessionEventTotals,
            engagement,
            dailyActivity: dailyRows,
            hourlyActivity: hourlyRows,
            aliases,
        },
    });
}
