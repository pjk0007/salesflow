import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 핵심 리드 — 인게이지먼트가 높은 고객을 별도로 모아 본다.
 * 기준(하나라도 충족): 방문 N회 이상 / 총 체류 M초 이상 / 메일 클릭 K회 이상.
 * 이메일 캠페인 맥락이라 record(고객)에 연결된 visitor만 대상으로 한다.
 *
 * Query: minVisits(기본3), minDurationSec(기본180), minClicks(기본2)
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const minVisits = Math.max(1, Number(sp.get("minVisits")) || 3);
    const minDurationSec = Math.max(0, Number(sp.get("minDurationSec")) || 180);
    const minClicks = Math.max(1, Number(sp.get("minClicks")) || 2);
    const limit = Math.min(Number(sp.get("limit")) || 50, 200);

    try {
        const rows = (await db.execute(sql`
            WITH visitor_dur AS (
                SELECT visitor_id, COALESCE(SUM(duration), 0)::int AS total_dur
                FROM tracker_sessions
                GROUP BY visitor_id
            ),
            visitor_clicks AS (
                -- visitor가 연결된 record로 발송된 메일의 클릭 수
                SELECT v.id AS visitor_id, COUNT(c.id)::int AS click_count
                FROM tracker_visitors v
                JOIN email_send_logs s ON s.record_id = v.record_id
                JOIN email_click_logs c ON c.send_log_id = s.id
                WHERE v.record_id IS NOT NULL
                GROUP BY v.id
            )
            SELECT
                v.id,
                v.record_id        AS "recordId",
                v.email,
                v.name,
                v.total_visits     AS "totalVisits",
                v.last_seen_at     AS "lastSeenAt",
                COALESCE(d.total_dur, 0)   AS "totalDurationSec",
                COALESCE(cl.click_count, 0) AS "clickCount"
            FROM tracker_visitors v
            LEFT JOIN visitor_dur d ON d.visitor_id = v.id
            LEFT JOIN visitor_clicks cl ON cl.visitor_id = v.id
            WHERE v.org_id = ${user.orgId}
              AND v.record_id IS NOT NULL
              AND (
                    v.total_visits >= ${minVisits}
                 OR COALESCE(d.total_dur, 0) >= ${minDurationSec}
                 OR COALESCE(cl.click_count, 0) >= ${minClicks}
              )
            ORDER BY
                (CASE WHEN v.total_visits >= ${minVisits} THEN 1 ELSE 0 END
                 + CASE WHEN COALESCE(d.total_dur,0) >= ${minDurationSec} THEN 1 ELSE 0 END
                 + CASE WHEN COALESCE(cl.click_count,0) >= ${minClicks} THEN 1 ELSE 0 END) DESC,
                COALESCE(cl.click_count, 0) DESC,
                v.total_visits DESC
            LIMIT ${limit}
        `)) as unknown as Array<{
            id: number;
            recordId: number | null;
            email: string | null;
            name: string | null;
            totalVisits: number;
            lastSeenAt: string;
            totalDurationSec: number;
            clickCount: number;
        }>;

        return NextResponse.json({
            success: true,
            data: {
                criteria: { minVisits, minDurationSec, minClicks },
                leads: rows,
            },
        });
    } catch (error) {
        console.error("Key leads error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
