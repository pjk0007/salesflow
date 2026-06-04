import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 핵심 리드 — 인게이지먼트가 높은 "전환 대상" 고객을 모아 본다.
 * 기준(하나라도 충족): 방문 N회↑ / 총 체류 M초↑ / 메일 클릭 K회↑.
 *
 * - record × 프로덕트(사이트) 단위로 집계 (같은 고객이 여러 visitor row로 중복되지 않게).
 * - 그 프로덕트의 funnel 전환단계(예: 구독중/전환)에 이미 도달한 record는 제외
 *   (이미 결제중인 고객은 전환 대상이 아니므로).
 *
 * Query: minVisits(기본3), minDurationSec(기본180), minClicks(기본2), limit
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
            WITH
            -- 사이트별 funnel 전환단계 정의 (마지막 stage의 record_field 매칭)
            site_conv AS (
                SELECT site_id,
                       (stages->-1->'match'->>'field') AS conv_field,
                       (stages->-1->'match'->>'value') AS conv_value
                FROM tracker_funnels
            ),
            -- visitor별 체류시간 합
            visitor_dur AS (
                SELECT visitor_id, COALESCE(SUM(duration), 0)::int AS total_dur
                FROM tracker_sessions
                GROUP BY visitor_id
            ),
            -- record×site 단위 인게이지먼트 집계 (visitor 여러 개를 합침)
            agg AS (
                SELECT
                    v.record_id,
                    v.site_id,
                    MAX(v.email)        AS email,
                    MAX(v.name)         AS name,
                    SUM(v.total_visits)::int AS visits,
                    SUM(COALESCE(d.total_dur, 0))::int AS duration_sec,
                    MAX(v.last_seen_at) AS last_seen
                FROM tracker_visitors v
                LEFT JOIN visitor_dur d ON d.visitor_id = v.id
                WHERE v.org_id = ${user.orgId}
                  AND v.record_id IS NOT NULL
                GROUP BY v.record_id, v.site_id
            ),
            -- record별 메일 클릭 수 (사이트 무관 — 메일은 record 단위 발송)
            record_clicks AS (
                SELECT s.record_id, COUNT(c.id)::int AS click_count
                FROM email_send_logs s
                JOIN email_click_logs c ON c.send_log_id = s.id
                WHERE s.record_id IS NOT NULL
                GROUP BY s.record_id
            )
            SELECT
                a.record_id        AS "recordId",
                a.site_id          AS "siteId",
                ts.name            AS product,
                a.email,
                a.name,
                a.visits           AS "totalVisits",
                a.duration_sec     AS "totalDurationSec",
                COALESCE(rc.click_count, 0) AS "clickCount",
                a.last_seen        AS "lastSeenAt"
            FROM agg a
            JOIN tracker_sites ts ON ts.id = a.site_id
            LEFT JOIN record_clicks rc ON rc.record_id = a.record_id
            WHERE (
                    a.visits >= ${minVisits}
                 OR a.duration_sec >= ${minDurationSec}
                 OR COALESCE(rc.click_count, 0) >= ${minClicks}
                  )
              -- 이미 그 프로덕트의 전환단계에 도달한(결제중) record는 제외
              AND NOT EXISTS (
                    SELECT 1
                    FROM record_events re
                    JOIN site_conv sc ON sc.site_id = a.site_id
                    WHERE re.record_id = a.record_id
                      AND re.type = sc.conv_field
                      AND re.label = sc.conv_value
              )
            ORDER BY
                (CASE WHEN a.visits >= ${minVisits} THEN 1 ELSE 0 END
                 + CASE WHEN a.duration_sec >= ${minDurationSec} THEN 1 ELSE 0 END
                 + CASE WHEN COALESCE(rc.click_count, 0) >= ${minClicks} THEN 1 ELSE 0 END) DESC,
                COALESCE(rc.click_count, 0) DESC,
                a.visits DESC
            LIMIT ${limit}
        `)) as unknown as Array<{
            recordId: number;
            siteId: number;
            product: string | null;
            email: string | null;
            name: string | null;
            totalVisits: number;
            totalDurationSec: number;
            clickCount: number;
            lastSeenAt: string;
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
