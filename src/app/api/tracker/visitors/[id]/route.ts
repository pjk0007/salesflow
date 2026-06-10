import { NextRequest, NextResponse } from "next/server";
import {
    db,
    trackerSites,
    trackerVisitors,
    trackerSessions,
    trackerEvents,
    trackerEventAliases,
} from "@/lib/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const visitorPk = Number(id);
    if (!visitorPk) {
        return NextResponse.json({ success: false, error: "잘못된 ID" }, { status: 400 });
    }

    const visitor = await db.query.trackerVisitors.findFirst({
        where: eq(trackerVisitors.id, visitorPk),
    });
    if (!visitor) {
        return NextResponse.json({ success: false, error: "방문자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 해당 site가 user의 org에 속하는지 검증
    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, visitor.siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    // record로 식별된 사람이면 같은 record의 모든 visitor를 묶어서 본다
    let groupVisitors = [visitor];
    if (visitor.recordId) {
        groupVisitors = await db
            .select()
            .from(trackerVisitors)
            .where(
                and(
                    eq(trackerVisitors.siteId, visitor.siteId),
                    eq(trackerVisitors.recordId, visitor.recordId),
                ),
            );
    }
    const visitorIds = groupVisitors.map((v) => v.id);

    const sessions = await db
        .select()
        .from(trackerSessions)
        .where(inArray(trackerSessions.visitorId, visitorIds))
        .orderBy(desc(trackerSessions.startedAt))
        .limit(30);

    // 세션 타임라인용 — 가져온 세션에 속한 이벤트 전체 (시간순)
    const sessionIds = sessions.map((s) => s.id);
    const events = sessionIds.length
        ? await db
            .select()
            .from(trackerEvents)
            .where(inArray(trackerEvents.sessionId, sessionIds))
            .orderBy(trackerEvents.occurredAt)
            .limit(1000)
        : [];

    // 관심도 집계 (전체 기간, 이벤트 limit 무관)
    const [sectionRows, clickRows, pageRows, dailyRows, hourlyRows, aliasRows] = await Promise.all([
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
                date: sql<string>`${trackerEvents.occurredAt}::date::text`,
                count: sql<number>`COUNT(*)::int`,
            })
            .from(trackerEvents)
            .where(inArray(trackerEvents.visitorId, visitorIds))
            .groupBy(sql`${trackerEvents.occurredAt}::date`)
            .orderBy(sql`${trackerEvents.occurredAt}::date`),
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
    ]);

    // 별칭 라벨 머지 (섹션/클릭 이름 → 사람이 읽는 라벨)
    const aliasMap = new Map(aliasRows.map((a) => [`${a.eventType}:${a.eventName}`, a.label]));
    const engagement = {
        sections: sectionRows
            .filter((r) => r.name)
            .map((r) => ({ ...r, name: r.name!, label: aliasMap.get(`SECTION_VIEW:${r.name}`) ?? null })),
        clicks: clickRows
            .filter((r) => r.name)
            .map((r) => ({ ...r, name: r.name!, label: aliasMap.get(`CLICK:${r.name}`) ?? null })),
        pages: pageRows.filter((r) => r.url).map((r) => ({ ...r, url: r.url! })),
    };

    // 그룹 합산 요약
    const summary = {
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
    const aliases = Object.fromEntries(aliasMap);

    return NextResponse.json({
        success: true,
        data: {
            visitor,
            summary,
            sessions,
            events,
            engagement,
            dailyActivity: dailyRows,
            hourlyActivity: hourlyRows,
            aliases,
        },
    });
}
