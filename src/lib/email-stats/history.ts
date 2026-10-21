import type { StatsConn } from "./connection";
import type { StatsState } from "./state";
import type { EmailStatsRunStats } from "./worker-types";
import { lateEventRanges, markWatermarks } from "./late-events";
import { backfillAllowed, backfillPhase, kstToday, nextBackfillChunk, nightlyChunks, nightlyDue, type DateRange } from "./rules";
import { addDaysYmd } from "../kst";
import { recomputeRange } from "./rollup";
const days = (r: DateRange) => (Date.parse(r.to) - Date.parse(r.from)) / 86400000 + 1;

export async function runNightly(conn: StatsConn, state: StatsState, now: Date, force: boolean, hasBudget: () => boolean, stats: EmailStatsRunStats) {
    if (!state.filled_from || (!force && !nightlyDue(state.nightly_date, now)))
        return;
    if (!hasBudget())
        return;
    const late = await lateEventRanges(conn, state, now);
    for (const range of late.ranges) {
        if (!hasBudget())
            return;
        await recomputeRange(conn, state.org_id, range);
        stats.nightly.lateDays += days(range);
    }
    await markWatermarks(conn, state.org_id, late.next);
    for (const range of nightlyChunks(state.nightly_next, state.filled_from, now)) {
        if (!hasBudget())
            return;
        await recomputeRange(conn, state.org_id, range);
        stats.nightly.days += days(range);
        await conn.unsafe("UPDATE email_stats_state SET nightly_next=$2 WHERE org_id=$1", [state.org_id, addDaysYmd(range.from, -1)]);
    }
    await conn.unsafe("UPDATE email_stats_state SET nightly_date=$2,nightly_next=NULL WHERE org_id=$1", [state.org_id, kstToday(now)]);
    stats.nightly.orgs++;
}

export async function runBackfill(conn: StatsConn, state: StatsState, now: Date, hasBudget: () => boolean, stats: EmailStatsRunStats) {
    if (!state.filled_from || state.backfill_done_at)
        return;
    let cursor = state.filled_from;
    while (true) {
        const phase = backfillPhase(cursor, state.first_send_date, now);
        if (phase === "done") {
            await conn.unsafe("UPDATE email_stats_state SET backfill_done_at=$2 WHERE org_id=$1", [state.org_id, now.toISOString()]);
            stats.backfill.doneOrgs++;
            return;
        }
        if (!backfillAllowed(phase, now) || !hasBudget())
            return;
        const range = nextBackfillChunk(cursor, state.first_send_date)!;
        await recomputeRange(conn, state.org_id, range);
        cursor = range.from;
        await conn.unsafe("UPDATE email_stats_state SET filled_from=$2 WHERE org_id=$1", [state.org_id, cursor]);
        stats.backfill.days += days(range);
        if (hasBudget())
            await new Promise(resolve => setTimeout(resolve, 300));
    }
}
