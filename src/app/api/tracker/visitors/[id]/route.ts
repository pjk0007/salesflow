import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors, trackerSessions, trackerEvents } from "@/lib/db";
import { eq, and, desc, inArray } from "drizzle-orm";
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

    const events = await db
        .select()
        .from(trackerEvents)
        .where(inArray(trackerEvents.visitorId, visitorIds))
        .orderBy(desc(trackerEvents.occurredAt))
        .limit(50);

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

    return NextResponse.json({
        success: true,
        data: { visitor, summary, sessions, events },
    });
}
