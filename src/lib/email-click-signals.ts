import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { ClickSignal } from "@/components/email/clicks/types";

/** 클릭이 없는 발송의 신호. 맵에 없는 발송은 이 값으로 채운다 */
export const EMPTY_CLICK_SIGNAL: ClickSignal = { clickCount: 0, botClickCount: 0, hasSiteAction: false };

/**
 * 발송별 클릭 신호 (발송 이력·통합 로그·MCP). 클릭이 있는 발송만 맵에 담는다.
 * - clickCount: 사람 클릭 수(is_bot = false), botClickCount: 봇 클릭 수
 * - hasSiteAction: 이 발송 클릭의 click_id로 이어진 "같은 조직" 사이트 세션에 CLICK·CUSTOM 이벤트가 1건 이상.
 *   봇 클릭의 click_id도 본다. 표시용이며 봇 판정에는 쓰지 않는다 (0절)
 */
export async function clickSignalsForSendLogs(orgId: string, logIds: number[]): Promise<Map<number, ClickSignal>> {
    const out = new Map<number, ClickSignal>();
    if (logIds.length === 0) return out;
    // 원문 SQL로 쓴다 — builder의 단일 표 select는 칼럼에 표 이름을 붙이지 않아(isSingleTable),
    // 서브쿼리 안의 바깥 칼럼 참조가 안쪽 표(ts.click_id, st.org_id)에 묶여 늘 참이 된다
    const rows = (await db.execute(sql`
        SELECT c.send_log_id AS "sendLogId",
               count(*) FILTER (WHERE c.is_bot = false)::int AS "clickCount",
               count(*) FILTER (WHERE c.is_bot = true)::int AS "botClickCount",
               EXISTS (
                   SELECT 1
                   FROM email_click_logs c2
                   JOIN tracker_sessions ts ON ts.click_id = c2.click_id
                   JOIN tracker_sites st ON st.id = ts.site_id AND st.org_id = c2.org_id
                   JOIN tracker_events te ON te.session_id = ts.id
                   WHERE c2.send_log_id = c.send_log_id
                     AND c2.org_id = ${orgId}::uuid
                     AND te.event_type IN ('CLICK', 'CUSTOM')
               ) AS "hasSiteAction"
        FROM email_click_logs c
        WHERE c.org_id = ${orgId}::uuid
          AND c.send_log_id = ANY(${sql.param(logIds)}::int[])
        GROUP BY c.send_log_id
    `)) as unknown as Array<{ sendLogId: number; clickCount: number; botClickCount: number; hasSiteAction: boolean }>;
    for (const r of rows) {
        out.set(r.sendLogId, {
            clickCount: r.clickCount,
            botClickCount: r.botClickCount,
            hasSiteAction: r.hasSiteAction === true,
        });
    }
    return out;
}
