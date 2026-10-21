export interface EmailStatsRunStats {
    orgs: number;
    errors: number;
    durationMs: number;
    skipped?: "locked" | "index_pending" | "off";
    recordsSkipped?: "index_pending";
    recent: {
        attrInserted: number;
        written: number;
        deleted: number;
    };
    nightly: {
        orgs: number;
        days: number;
        lateDays: number;
    };
    backfill: {
        days: number;
        doneOrgs: number;
    };
}
export interface EmailStatsOptions {
    now?: Date;
    env?: Record<string, string | undefined>;
    force?: "nightly";
    budgetMs?: number;
}
