import { sql } from "drizzle-orm";
import { executeSql, type StatsConn } from "./connection";
import { kstDayBounds, type DateRange } from "./rules";

export async function recomputeRecords(conn: StatsConn, orgId: string, range: DateRange) {
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    return executeSql(
        conn,
        sql`WITH src AS (
        SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date stat_date,count(*)::int total FROM records
        WHERE org_id=${orgId}::uuid AND created_at>=${fromIso}::timestamptz AND created_at<${toIso}::timestamptz
            GROUP BY 1
    ), cur AS (SELECT * FROM home_stats_daily WHERE org_id=${orgId}::uuid AND source='records' AND template_name=''
            AND stat_date BETWEEN ${range.from}::date AND ${range.to}::date),
    changed AS (SELECT s.* FROM src s LEFT JOIN cur c USING(stat_date) WHERE c.org_id IS NULL OR s.total IS
            DISTINCT FROM c.total),
    ins AS (INSERT INTO home_stats_daily(org_id,stat_date,source,template_name,total)
        SELECT ${orgId}::uuid,stat_date,'records','',total FROM changed
        ON CONFLICT ON CONSTRAINT home_stats_daily_pkey DO UPDATE SET total=EXCLUDED.total,updated_at=now()
            RETURNING 1),
    del AS (DELETE FROM home_stats_daily d WHERE d.org_id=${orgId}::uuid AND d.source='records' AND d.template_name=''
            AND d.stat_date BETWEEN ${range.from}::date AND ${range.to}::date
        AND NOT EXISTS(SELECT 1 FROM src s WHERE s.stat_date=d.stat_date) RETURNING 1)
    SELECT (SELECT count(*)::int FROM ins) written,(SELECT count(*)::int FROM del) deleted`
    );
}
