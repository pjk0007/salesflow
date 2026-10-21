import { queryClient } from "../db";
import { RECORDS_INDEX_READY_SQL, SEND_LOG_INDEXES_READY_SQL } from "../db/send-log-indexes";
import { describeReplyError } from "../email-reply-rules";
import { ensureState, markRecent, readState } from "./state";
import { recentWindow } from "./rules";
import { recomputeRange } from "./rollup";
import { runNightly, runBackfill } from "./history";
import type { EmailStatsRunStats, EmailStatsOptions } from "./worker-types";
export type { EmailStatsRunStats } from "./worker-types";
export const EMAIL_STATS_LOCK_KEY = 0x5c4edf18;

export async function runEmailStats(opts: EmailStatsOptions = {}): Promise<EmailStatsRunStats> {
    const started = Date.now();
    const now = opts.now ?? new Date();
    const env = opts.env ?? process.env;
    const stats: EmailStatsRunStats = {
        orgs: 0,
        errors: 0,
        durationMs: 0,
        recent: { attrInserted: 0, written: 0, deleted: 0 },
        nightly: { orgs: 0, days: 0, lateDays: 0 },
        backfill: { days: 0, doneOrgs: 0 }
    };
    if (env.EMAIL_STATS_WORKER === "off")
        return { ...stats, skipped: "off" };
    const conn = await queryClient.reserve();
    let locked = false;
    const hasBudget = () => Date.now() - started < (opts.budgetMs ?? 120000);
    try {
        const lock = await conn.unsafe<{
            ok: boolean;
        }[]>("SELECT pg_try_advisory_lock($1) AS ok", [EMAIL_STATS_LOCK_KEY]);
        locked = lock[0].ok;
        if (!locked)
            return { ...stats, skipped: "locked" };
        await conn.unsafe("SET statement_timeout='120s'");
        await conn.unsafe("SET lock_timeout='5s'");
        const ready = await conn.unsafe<{
            ready: number;
        }[]>(SEND_LOG_INDEXES_READY_SQL);
        if (ready[0].ready < 2)
            return { ...stats, skipped: "index_pending" };
        const recordIndex = await conn.unsafe<{
            ready: boolean;
        }[]>(RECORDS_INDEX_READY_SQL);
        const recordsReady = recordIndex[0].ready;
        if (!recordsReady)
            stats.recordsSkipped = "index_pending";
        const orgs = await conn.unsafe<{
            id: string;
        }[]>("SELECT id FROM organizations ORDER BY id");
        const succeeded: string[] = [];
        const fail = async (orgId: string, error: unknown) => {
            stats.errors++;
            await conn.unsafe(
                "UPDATE email_stats_state SET last_error=$2,last_error_at=$3 WHERE org_id=$1",
                [orgId, describeReplyError(error), now.toISOString()]
            );
        };
        for (const org of orgs) {
            stats.orgs++;
            try {
                await ensureState(conn, org.id, recordsReady);
                const range = recentWindow(now);
                const asOf = opts.now ?? new Date();
                const result = await recomputeRange(conn, org.id, range, { records: recordsReady, leads: recordsReady });
                for (const key of ["attrInserted", "written", "deleted"] as const)
                    stats.recent[key] += result[key];
                await markRecent(conn, org.id, range.from, asOf, recordsReady);
                succeeded.push(org.id);
            } catch (error) {
                await fail(org.id, error);
            }
        }
        if (recordsReady) {
            const failed = new Set<string>();
            for (const orgId of succeeded) {
                try {
                    await runNightly(conn, await readState(conn, orgId), now, opts.force === "nightly", hasBudget, stats);
                } catch (error) {
                    failed.add(orgId);
                    await fail(orgId, error);
                }
            }
            for (const orgId of succeeded) {
                if (failed.has(orgId))
                    continue;
                try {
                    // budgetMs=0 계약은 첫 백필 조각 뒤 멈추며, 이후 회차에서 커서를 이어간다.
                    const backfillBudget = () => hasBudget() || (opts.budgetMs === 0 && stats.backfill.days === 0);
                    await runBackfill(conn, await readState(conn, orgId), now, backfillBudget, stats);
                } catch (error) {
                    await fail(orgId, error);
                }
            }
        }
        return stats;
    } finally {
        try {
            await conn.unsafe("RESET statement_timeout");
        } finally {
            try {
                await conn.unsafe("RESET lock_timeout");
            } finally {
                try {
                    if (locked)
                        await conn.unsafe("SELECT pg_advisory_unlock($1)", [EMAIL_STATS_LOCK_KEY]);
                } finally {
                    conn.release();
                    stats.durationMs = Date.now() - started;
                    console.info(
                        `[email-stats] orgs=${stats.orgs}` +
                        ` recent=${stats.recent.written}/${stats.recent.deleted}` +
                        ` nightly=${stats.nightly.days} backfill=${stats.backfill.days}` +
                        ` ms=${stats.durationMs}`
                    );
                }
            }
        }
    }
}
