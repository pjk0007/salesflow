import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * GET /api/tracker/sites/[id]/event-name-options
 *
 * 사이트에서 실제 발생한 (event_type, event_name) 목록 반환 — 별칭 등록 다이얼로그의 Combobox 자동완성용.
 * 전체 기간 조회, occurrences desc, 100건 LIMIT.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const { id } = await params;
    const siteId = Number(id);
    if (!siteId) return NextResponse.json({ success: false, error: "잘못된 ID입니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    const rows = (await db.execute(sql`
        SELECT
            event_type AS "eventType",
            event_name AS "eventName",
            COUNT(*)::int AS occurrences
        FROM tracker_events
        WHERE site_id = ${siteId}
          AND event_type IN ('SECTION_VIEW', 'CLICK')
          AND event_name IS NOT NULL
        GROUP BY event_type, event_name
        ORDER BY occurrences DESC
        LIMIT 100
    `)) as unknown as Array<{
        eventType: "SECTION_VIEW" | "CLICK";
        eventName: string;
        occurrences: number;
    }>;

    return NextResponse.json({ success: true, data: rows });
}
