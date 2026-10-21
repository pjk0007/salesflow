import { sql } from "drizzle-orm";
import { executeSql, type StatsConn } from "./connection";
import { kstDayBounds, type DateRange } from "./rules";

export async function recomputeLeads(conn: StatsConn, orgId: string, range: DateRange) {
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    return executeSql(
        conn,
        sql`WITH src AS (
        SELECT (a.created_at AT TIME ZONE 'Asia/Seoul')::date AS stat_date,a.workspace_id,
            a.message->'journeyPriority'->>'customerKey' AS customer_key,
            CASE WHEN bool_or(a.message->'journeyPriority'->>'tier'='urgent') THEN 'urgent' ELSE 'highlight'
            END AS tier
        FROM customer_journey_alerts a JOIN workspaces w ON w.id=a.workspace_id AND w.org_id=a.org_id
        JOIN records r ON r.id=a.record_id AND r.org_id=a.org_id AND r.workspace_id=a.workspace_id
        WHERE a.org_id=${orgId}::uuid AND a.created_at>=${fromIso}::timestamptz AND a.created_at<${toIso}::timestamptz
            AND a.status<>'skipped'
        AND a.message->'journeyPriority'->>'version'='1' AND a.message->'journeyPriority'->>'rankEligible'='true'
        AND a.message->'journeyPriority'->>'tier' IN ('urgent','highlight') GROUP BY 1,2,3
    ), cur AS (SELECT * FROM email_stats_lead_days WHERE org_id=${orgId}::uuid AND stat_date BETWEEN ${range.from}::date
            AND ${range.to}::date),
    changed AS (SELECT s.* FROM src s LEFT JOIN cur c USING(stat_date,workspace_id,customer_key) WHERE c.org_id
            IS NULL OR s.tier IS DISTINCT FROM c.tier),
    ins AS (INSERT INTO email_stats_lead_days(org_id,stat_date,workspace_id,customer_key,tier)
        SELECT ${orgId}::uuid,stat_date,workspace_id,customer_key,tier FROM changed
        ON CONFLICT ON CONSTRAINT email_stats_lead_days_pkey DO UPDATE SET tier=EXCLUDED.tier,updated_at=now()
            RETURNING 1),
    del AS (DELETE FROM email_stats_lead_days d WHERE d.org_id=${orgId}::uuid AND d.stat_date BETWEEN ${range.from}::date
            AND ${range.to}::date
        AND NOT EXISTS(SELECT 1 FROM src s WHERE (s.stat_date,s.workspace_id,s.customer_key)=(d.stat_date,
            d.workspace_id,d.customer_key)) RETURNING 1)
    SELECT (SELECT count(*)::int FROM ins) AS written,(SELECT count(*)::int FROM del) AS deleted`
    );
}
