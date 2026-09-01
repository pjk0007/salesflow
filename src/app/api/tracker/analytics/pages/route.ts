import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { queryPageAnalytics } from "@/lib/tracker/analytics-queries";

/**
 * 사이트의 방문된 페이지 목록 — path 기준 그룹, 최신 title + 페이지뷰 수.
 * 방문자 탭 페이지 필터 드롭다운용. 페이지뷰 많은 순 상위 100개.
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const siteIdStr = req.nextUrl.searchParams.get("siteId");
    if (!siteIdStr) {
        return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });
    }
    const siteId = Number(siteIdStr);

    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    const data = await queryPageAnalytics({ siteId });

    return NextResponse.json({ success: true, data });
}
