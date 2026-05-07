import { NextRequest, NextResponse } from "next/server";
import { db, records, trackerVisitors, trackerEvents } from "@/lib/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

const DEFAULT_EVENT_LIMIT = 10;

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "잘못된 ID" }, { status: 400 });
    }

    // 권한 체크 (record가 user 조직에 속해야 함)
    const [record] = await db
        .select()
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));
    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    const eventLimitParam = req.nextUrl.searchParams.get("eventLimit");
    const eventLimit = Math.min(
        Math.max(Number(eventLimitParam) || DEFAULT_EVENT_LIMIT, 1),
        50,
    );

    // 연결된 visitors
    const visitors = await db
        .select()
        .from(trackerVisitors)
        .where(eq(trackerVisitors.recordId, recordId));

    if (visitors.length === 0) {
        return NextResponse.json({
            success: true,
            data: { summary: null, recentEvents: [], visitors: [] },
        });
    }

    // 집계
    const totalVisits = visitors.reduce((sum, v) => sum + v.totalVisits, 0);
    const totalPageviews = visitors.reduce((sum, v) => sum + v.totalPageviews, 0);
    const totalEvents = visitors.reduce((sum, v) => sum + v.totalEvents, 0);
    const firstSeen = visitors.reduce<Date | null>(
        (min, v) => (!min || v.firstSeenAt < min ? v.firstSeenAt : min),
        null,
    );
    const lastSeen = visitors.reduce<Date | null>(
        (max, v) => (!max || v.lastSeenAt > max ? v.lastSeenAt : max),
        null,
    );

    const visitorIds = visitors.map((v) => v.id);
    const recentEvents = await db
        .select()
        .from(trackerEvents)
        .where(inArray(trackerEvents.visitorId, visitorIds))
        .orderBy(desc(trackerEvents.occurredAt))
        .limit(eventLimit);

    return NextResponse.json({
        success: true,
        data: {
            summary: {
                totalVisits,
                totalPageviews,
                totalEvents,
                deviceCount: visitors.length,
                firstSeen,
                lastSeen,
                devices: visitors.map((v) => ({
                    id: v.id,
                    visitorId: v.visitorId,
                    type: v.deviceType,
                    browser: v.browser,
                    os: v.os,
                    lastSeen: v.lastSeenAt,
                    totalVisits: v.totalVisits,
                })),
            },
            recentEvents,
            visitors,
        },
    });
}
