import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors, trackerSessions, trackerEvents } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { JourneyEvent, JourneySummary } from "@/components/journey/types";
import {
    DAY_MS,
    STALE_DAYS,
    loadTrackerLabelMaps,
    normalizeTrackerEvents,
    firstInflowChannel,
    buildAttribution,
    buildNextActions,
} from "@/lib/journey/tracker-journey";

/**
 * 익명 방문자 여정 — record 없이 트래커 이벤트만으로 여정 데이터 구성.
 * 응답 shape은 record 여정과 동일 (JourneyPage UI 공용).
 */
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

    try {
        const visitor = await db.query.trackerVisitors.findFirst({
            where: eq(trackerVisitors.id, visitorPk),
        });
        if (!visitor) {
            return NextResponse.json({ success: false, error: "방문자를 찾을 수 없습니다." }, { status: 404 });
        }

        // 해당 site가 user의 org에 속하는지 검증
        const [site] = await db
            .select({ id: trackerSites.id })
            .from(trackerSites)
            .where(and(eq(trackerSites.id, visitor.siteId), eq(trackerSites.orgId, user.orgId)));
        if (!site) {
            return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
        }

        // record로 식별된 사람이면 같은 record의 visitor를 묶어서 (디바이스 여러 대)
        let visitorIds = [visitor.id];
        if (visitor.recordId) {
            const group = await db
                .select({ id: trackerVisitors.id })
                .from(trackerVisitors)
                .where(
                    and(
                        eq(trackerVisitors.siteId, visitor.siteId),
                        eq(trackerVisitors.recordId, visitor.recordId),
                    ),
                );
            visitorIds = group.map((v) => v.id);
        }

        const [trkSessions, trkEvents] = await Promise.all([
            db.select().from(trackerSessions).where(inArray(trackerSessions.visitorId, visitorIds)),
            db.select().from(trackerEvents).where(inArray(trackerEvents.visitorId, visitorIds)),
        ]);

        const labelMaps = await loadTrackerLabelMaps([visitor.siteId]);
        const events = normalizeTrackerEvents(trkSessions, trkEvents, labelMaps);
        events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

        const summary = buildVisitorSummary(events, trkSessions);
        const attribution = buildAttribution(events, null);
        const nextActions = buildNextActions(events, summary);

        return NextResponse.json({ success: true, data: { summary, events, attribution, nextActions } });
    } catch (error) {
        console.error("Visitor journey fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

// record가 없으니 단계/전환 없이 — 활동 밀도·이탈·일별 활동만 채운 요약
function buildVisitorSummary(
    events: JourneyEvent[],
    sessions: (typeof trackerSessions.$inferSelect)[],
): JourneySummary {
    const firstSeenAt = events.length ? events[0].at : null;
    const lastActiveAt = events.length ? events[events.length - 1].at : null;

    const channels: Record<string, number> = {};
    for (const e of events) channels[e.source] = (channels[e.source] ?? 0) + 1;

    const dwells = sessions.map((s) => s.duration ?? 0).filter((d) => d > 0);
    const avgDwellSec = dwells.length ? Math.round(dwells.reduce((a, b) => a + b, 0) / dwells.length) : 0;

    const daysSince = lastActiveAt
        ? Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / DAY_MS)
        : 0;

    const dailyMap = new Map<string, number>();
    for (const e of events) {
        const day = e.at.slice(0, 10);
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
    }
    const dailyActivity = [...dailyMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        firstSeenAt,
        convertedAt: null,
        daysToConvert: null,
        totalEvents: events.length,
        currentStage: null,
        stages: [],
        reachedStages: [],
        stageDurations: [],
        firstChannel: firstInflowChannel(events) ?? (events.length ? events[0].channel : null),
        channels,
        density: {
            visits: sessions.length || events.filter((e) => e.channel === "사이트").length,
            emailSent: 0,
            emailClicks: 0,
            emailClickRate: 0,
            avgDwellSec,
            sessions: sessions.length,
        },
        inactivity: { lastActiveAt, daysSince, isStale: daysSince >= STALE_DAYS },
        dailyActivity,
    };
}
