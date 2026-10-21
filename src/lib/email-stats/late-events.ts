import type { StatsConn } from "./connection";
import { mergeDateRanges, lateCutoff } from "./rules";
import { watermarks, type StatsState, type Watermarks } from "./state";

export async function lateEventRanges(conn: StatsConn, state: StatsState, now: Date) {
    const next = await watermarks(conn, state.org_id);
    const sources: [
        string,
        keyof Watermarks,
        string
    ][] = [
            ["email_open_logs", "wm_open_id", "e.is_machine=false"],
            ["email_click_logs", "wm_click_id", "e.is_bot=false"],
            ["email_replies", "wm_reply_id", "e.match_status='matched' AND e.kind IN ('human','auto_reply')"],
            ["email_unsubscribes", "wm_unsub_id", "e.source IN ('link','one_click')"],
            ["email_bounce_signals", "wm_complaint_id", "e.kind='complaint'"],
        ];
    const dates: string[] = [];
    for (const [table, key, predicate] of sources) {
        const rows = await conn.unsafe<{
            date: string;
        }[]>(`SELECT DISTINCT a.stat_date::text AS date FROM ${table} e
            JOIN email_stats_send_attr a ON a.send_log_id=e.send_log_id AND a.org_id=e.org_id
            WHERE e.org_id=$1 AND e.id>$2 AND e.id<=$3 AND ${predicate}`, [state.org_id, state[key], next[key]]);
        dates.push(...rows.map(r => r.date));
    }
    const roots = await conn.unsafe<{
        date: string;
    }[]>(
        `SELECT DISTINCT root.stat_date::text AS date FROM email_replies r
        LEFT JOIN email_stats_send_attr a ON a.send_log_id=r.send_log_id AND a.org_id=r.org_id
        JOIN email_stats_send_attr root ON root.send_log_id=COALESCE(r.root_log_id,a.root_log_id) AND root.org_id=r.org_id
        WHERE r.org_id=$1 AND r.id>$2 AND r.id<=$3 AND r.match_status='matched' AND r.kind IN ('human','auto_reply')`,
        [state.org_id, state.wm_reply_id, next.wm_reply_id]
    );
    dates.push(...roots.map(r => r.date));
    const cutoff = lateCutoff(now);
    return {
        ranges: mergeDateRanges(dates.filter(date => state.filled_from !== null && date >= state.filled_from && date <= cutoff)),
        next
    };
}

export async function markWatermarks(conn: StatsConn, orgId: string, wm: Watermarks) {
    await conn.unsafe(
        `UPDATE email_stats_state SET wm_open_id=$2,wm_click_id=$3,wm_reply_id=$4,wm_unsub_id=$5,wm_complaint_id=$6
            WHERE org_id=$1`,
        [orgId, wm.wm_open_id, wm.wm_click_id, wm.wm_reply_id, wm.wm_unsub_id, wm.wm_complaint_id]
    );
}
