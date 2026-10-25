import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import {
    SESSION_EVENT_LIMIT,
    SESSION_EVENT_PAGE_MAX,
    loadOlderSessionEvents,
    loadVisitorGroup,
} from "@/lib/tracker/visitor-detail";

const positiveInt = (raw: string | null) => (raw && /^\d+$/.test(raw) ? Number(raw) : 0);

/**
 * GET /api/tracker/visitors/{id}/events?sessionId=&beforeId=&limit=
 * 방문자 상세 세션 타임라인의 "이전 행동 더 보기" — beforeId 이벤트보다 앞선 이벤트를 시간순으로 돌려준다.
 * 세션은 이 방문자(또는 같은 record의 다른 기기) 것만 읽는다.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const visitorPk = positiveInt((await params).id);
    const sp = req.nextUrl.searchParams;
    const sessionId = positiveInt(sp.get("sessionId"));
    const beforeId = positiveInt(sp.get("beforeId"));
    if (!visitorPk || !sessionId || !beforeId) {
        return NextResponse.json({ success: false, error: "방문자·세션·기준 이벤트를 확인해주세요." }, { status: 400 });
    }
    const limit = Math.min(positiveInt(sp.get("limit")) || SESSION_EVENT_LIMIT, SESSION_EVENT_PAGE_MAX);

    try {
        const access = await loadVisitorGroup(visitorPk, user.orgId);
        if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        const data = await loadOlderSessionEvents({ sessionId, visitorIds: access.group.map((v) => v.id), beforeId, limit });
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Tracker visitor events error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
