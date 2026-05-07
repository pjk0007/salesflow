import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors, trackerSessions, trackerEvents } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
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

    const sessions = await db
        .select()
        .from(trackerSessions)
        .where(eq(trackerSessions.visitorId, visitor.id))
        .orderBy(desc(trackerSessions.startedAt))
        .limit(20);

    const events = await db
        .select()
        .from(trackerEvents)
        .where(eq(trackerEvents.visitorId, visitor.id))
        .orderBy(desc(trackerEvents.occurredAt))
        .limit(50);

    return NextResponse.json({
        success: true,
        data: { visitor, sessions, events },
    });
}
