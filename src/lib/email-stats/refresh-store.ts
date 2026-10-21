import { ensureState } from "./state";
import { queryClient } from "../db";
import { RECORDS_INDEX_READY_SQL, SEND_LOG_INDEXES_READY_SQL } from "../db/send-log-indexes";
import { EMAIL_STATS_LOCK_KEY } from "./worker";
import { recomputeRange } from "./rollup";
import { manualRefreshDecision } from "./manual-refresh";
import { kstToday } from "./rules";
import { addDaysYmd } from "../kst";
/** 호출자가 로그인·관리자 권한·자기 조직을 검증해야 한다. 실패해도 시작한 갱신의 쿨다운은 유지한다. */
export async function refreshStats(orgId: string, now = new Date()) {
    const conn = await queryClient.reserve();
    let locked = false;
    try {
        const [lock] = await conn.unsafe<{
            ok: boolean;
        }[]>("SELECT pg_try_advisory_lock($1) AS ok", [EMAIL_STATS_LOCK_KEY]);
        locked = lock.ok;
        if (!locked)
            return { status: 202, body: { success: true, data: { queued: false, running: true } } };
        await conn.unsafe("SET statement_timeout = '120s'");
        await conn.unsafe("SET enable_nestloop = off");
        await conn.unsafe("SET lock_timeout = '5s'");
        const [email] = await conn.unsafe<{
            ready: number;
        }[]>(SEND_LOG_INDEXES_READY_SQL);
        const [records] = await conn.unsafe<{
            ready: boolean;
        }[]>(RECORDS_INDEX_READY_SQL);
        if (email.ready < 2 || !records.ready) {
            return { status: 503, body: { success: false, error: "집계 준비 중입니다. 잠시 뒤 다시 눌러 주세요." } };
        }
        const rows = await conn.unsafe<{
            manual_refreshed_at: string | null;
        }[]>("SELECT manual_refreshed_at::text FROM email_stats_state WHERE org_id=$1", [orgId]);
        const decision = manualRefreshDecision(rows[0]?.manual_refreshed_at ? new Date(rows[0].manual_refreshed_at) : null, now);
        if (!decision.allowed) {
            return {
                status: 429,
                body: { success: false, error: decision.error, retryAfterSec: decision.retryAfterSec }
            };
        }
        await ensureState(conn, orgId, true);
        await conn.unsafe("UPDATE email_stats_state SET manual_refreshed_at=$2 WHERE org_id=$1", [orgId, now.toISOString()]);
        const to = kstToday(now);
        await recomputeRange(conn, orgId, { from: addDaysYmd(to, -1), to });
        await conn.unsafe("UPDATE email_stats_state SET recent_done_at=$2 WHERE org_id=$1", [orgId, now.toISOString()]);
        return { status: 200, body: { success: true, data: { asOf: now.toISOString() } } };
    } finally {
        try {
            await conn.unsafe("RESET statement_timeout");
        } finally {
            try {
                await conn.unsafe("RESET lock_timeout");
            } finally {
                try {
                    await conn.unsafe("RESET enable_nestloop");
                } finally {
                    try {
                        if (locked)
                            await conn.unsafe("SELECT pg_advisory_unlock($1)", [EMAIL_STATS_LOCK_KEY]);
                    } finally {
                        conn.release();
                    }
                }
            }
        }
    }
}
