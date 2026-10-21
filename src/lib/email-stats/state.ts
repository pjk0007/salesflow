import type { StatsConn } from "./connection";
export interface Watermarks {
    wm_open_id: number;
    wm_click_id: number;
    wm_reply_id: number;
    wm_unsub_id: number;
    wm_complaint_id: number;
}
export interface StatsState extends Watermarks {
    org_id: string;
    first_send_date: string | null;
    filled_from: string | null;
    backfill_done_at: Date | null;
    nightly_date: string | null;
    nightly_next: string | null;
}

export async function watermarks(conn: StatsConn, orgId: string): Promise<Watermarks> {
    const rows = await conn.unsafe<Watermarks[]>(`SELECT
        (SELECT COALESCE(max(id),0) FROM email_open_logs WHERE org_id=$1) wm_open_id,
        (SELECT COALESCE(max(id),0) FROM email_click_logs WHERE org_id=$1) wm_click_id,
        (SELECT COALESCE(max(id),0) FROM email_replies WHERE org_id=$1) wm_reply_id,
        (SELECT COALESCE(max(id),0) FROM email_unsubscribes WHERE org_id=$1) wm_unsub_id,
        (SELECT COALESCE(max(id),0) FROM email_bounce_signals WHERE org_id=$1) wm_complaint_id`, [orgId]);
    return rows[0];
}

export async function readState(conn: StatsConn, orgId: string): Promise<StatsState> {
    const rows = await conn.unsafe<StatsState[]>(`SELECT org_id,first_send_date::text,filled_from::text,backfill_done_at,nightly_date::text,nightly_next::text,
        wm_open_id,wm_click_id,wm_reply_id,wm_unsub_id,wm_complaint_id FROM email_stats_state WHERE org_id=$1`, [orgId]);
    return rows[0];
}

export async function ensureState(conn: StatsConn, orgId: string, recordsReady: boolean): Promise<StatsState> {
    const existing = await conn.unsafe("SELECT 1 FROM email_stats_state WHERE org_id=$1", [orgId]);
    if (!existing.length) {
        const wm = await watermarks(conn, orgId);
        await conn.unsafe(
            `INSERT INTO email_stats_state(org_id,wm_open_id,wm_click_id,wm_reply_id,wm_unsub_id,wm_complaint_id)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id) DO NOTHING`,
            [orgId, wm.wm_open_id, wm.wm_click_id, wm.wm_reply_id, wm.wm_unsub_id, wm.wm_complaint_id]
        );
    }
    if (recordsReady) {
        // records 색인이 없을 때는 원천 조회와 공통 하한 보정을 모두 보류한다.
        await conn.unsafe(`UPDATE email_stats_state SET first_send_date=LEAST(
            (SELECT (min(sent_at) AT TIME ZONE 'Asia/Seoul')::date FROM email_send_logs WHERE org_id=$1),
            (SELECT (min(created_at) AT TIME ZONE 'Asia/Seoul')::date FROM records WHERE org_id=$1)) WHERE
            org_id=$1`, [orgId]);
    }
    return readState(conn, orgId);
}

export async function markRecent(conn: StatsConn, orgId: string, from: string, asOf: Date, recordsReady: boolean) {
    if (!recordsReady) {
        await conn.unsafe("UPDATE email_stats_state SET recent_done_at=$2 WHERE org_id=$1", [orgId, asOf.toISOString()]);
        return;
    }
    await conn.unsafe(
        `UPDATE email_stats_state SET recent_done_at=$2,filled_from=LEAST(COALESCE(filled_from,$3::date),$3::date),
            last_error=NULL,updated_at=now() WHERE org_id=$1`,
        [orgId, asOf.toISOString(), from]
    );
}
