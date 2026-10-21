import { sql, type SQL } from "drizzle-orm";
import { openBaseSql, openedSendSql } from "../email-open-sql";
import { HEALTH_CATEGORY_SQL } from "../sender-health-rules";
import { kstDayBounds, type DateRange } from "./rules";

export function rollupSql(orgId: string, range: DateRange, accepted: SQL): SQL {
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    return sql`WITH s AS (       
    SELECT email_send_logs.id, email_send_logs.status, email_send_logs.trigger_type, email_send_logs.request_id,
           email_send_logs.nhn_status_code, email_send_logs.delivery_fail_source, email_send_logs.delivery_fail_side,
           email_send_logs.delivery_status_code,
           (${accepted}) AS accepted,                                         
           (${openBaseSql("email_send_logs")}) AS open_base,
           (${openedSendSql("email_send_logs", { orgId, since: fromIso })}) AS opened
    FROM email_send_logs
    WHERE email_send_logs.org_id = ${orgId}::uuid AND email_send_logs.sent_at >= ${fromIso}::timestamptz AND
            email_send_logs.sent_at < ${toIso}::timestamptz
),
hc  AS (SELECT c.send_log_id, c.click_id FROM email_click_logs c
        WHERE c.org_id = ${orgId}::uuid AND c.is_bot = false AND c.clicked_at >= ${fromIso}::timestamptz),
vis AS (SELECT hc.send_log_id,
               bool_or(EXISTS (SELECT 1 FROM tracker_events te WHERE te.session_id = ts.id AND te.event_type
            IN ('CLICK','CUSTOM'))) AS acted
        FROM hc JOIN tracker_sessions ts ON ts.click_id = hc.click_id
                JOIN tracker_sites st ON st.id = ts.site_id AND st.org_id = ${orgId}::uuid
        GROUP BY hc.send_log_id),
rep AS (SELECT r.send_log_id, bool_or(r.kind = 'human') AS human, bool_or(r.kind = 'auto_reply') AS auto
        FROM email_replies r
        WHERE r.org_id = ${orgId}::uuid AND r.match_status = 'matched' AND r.kind IN ('human','auto_reply')
          AND r.send_log_id IS NOT NULL AND r.received_at >= ${fromIso}::timestamptz
        GROUP BY r.send_log_id),
seq AS (SELECT DISTINCT COALESCE(r.root_log_id, ra.root_log_id) AS root_id   
        FROM email_replies r LEFT JOIN email_stats_send_attr ra ON ra.send_log_id = r.send_log_id
        WHERE r.org_id = ${orgId}::uuid AND r.match_status = 'matched' AND r.kind = 'human' AND r.received_at
            >= ${fromIso}::timestamptz),
uns AS (SELECT DISTINCT u.send_log_id FROM email_unsubscribes u
        WHERE u.org_id = ${orgId}::uuid AND u.source IN ('link','one_click') AND u.send_log_id IS NOT NULL),
cmp AS (SELECT DISTINCT b.send_log_id FROM email_bounce_signals b
        WHERE b.org_id = ${orgId}::uuid AND b.kind = 'complaint' AND b.send_log_id IS NOT NULL AND b.received_at
            >= ${fromIso}::timestamptz),
f AS (            
    SELECT a.stat_date, a.workspace_id, a.partition_id, a.trigger_type, a.campaign_kind, a.campaign_id, a.step_index,
           a.sender_profile_id, a.sender_domain, l.status, l.accepted, l.open_base, l.opened, l.delivery_status_code,
           (${sql.raw(HEALTH_CATEGORY_SQL)}) AS cat,
           l.id IN (SELECT send_log_id FROM hc) AS clicked,
           v.send_log_id IS NOT NULL AS visited, COALESCE(v.acted, false) AS acted,
           COALESCE(rep.human, false) AS replied, COALESCE(rep.auto, false) AS auto_replied,
           l.id IN (SELECT root_id FROM seq) AS seq_hit,
           l.id IN (SELECT send_log_id FROM uns) AS unsubscribed,
           l.id IN (SELECT send_log_id FROM cmp) AS complained
    FROM s l
    JOIN email_stats_send_attr a ON a.send_log_id = l.id AND a.org_id = ${orgId}::uuid AND a.stat_date BETWEEN
            ${range.from}::date AND ${range.to}::date
    LEFT JOIN vis v ON v.send_log_id = l.id
    LEFT JOIN rep ON rep.send_log_id = l.id
    WHERE NOT (COALESCE(l.trigger_type,'') LIKE 'test%' OR COALESCE(l.trigger_type,'') = 'journey_demo'
               OR l.status IN ('demo','cancelled'))                              
),
agg AS (          
    SELECT CASE WHEN GROUPING(campaign_kind) = 0 THEN 'campaign' WHEN GROUPING(partition_id) = 0 THEN 'partition'
                WHEN GROUPING(sender_profile_id) = 0 THEN 'sender' WHEN GROUPING(trigger_type) = 0 THEN 'trigger'
                ELSE 'total' END AS grain,
           stat_date, workspace_id,
           COALESCE(campaign_kind,'') AS campaign_kind, COALESCE(campaign_id,0) AS campaign_id, COALESCE(step_index,
            -1) AS step_index,
           COALESCE(partition_id,0) AS partition_id, COALESCE(sender_profile_id,0) AS sender_profile_id,
           COALESCE(sender_domain,'') AS sender_domain, COALESCE(trigger_type,'') AS trigger_type,
           count(*)::int AS total,
           count(*) FILTER (WHERE accepted)::int AS accepted,
           count(*) FILTER (WHERE status = 'sent')::int AS sent,
           count(*) FILTER (WHERE status IN ('failed','rejected'))::int AS failed,
           count(*) FILTER (WHERE status IN ('pending','uncertain'))::int AS pending,
           count(*) FILTER (WHERE cat = 'success')::int AS delivered,
           count(*) FILTER (WHERE cat IN ('failed','dsn_only'))::int AS bounced,
           count(*) FILTER (WHERE cat IN ('failed','dsn_only') AND delivery_status_code LIKE '5%')::int AS
            bounced_hard,
           count(*) FILTER (WHERE cat = 'sender_side')::int AS sender_side,
           count(*) FILTER (WHERE cat = 'nhn_unsub')::int AS nhn_unsub,
           count(*) FILTER (WHERE cat = 'send_reject')::int AS send_reject,
           count(*) FILTER (WHERE cat = 'unknown')::int AS unconfirmed,
           count(*) FILTER (WHERE open_base)::int AS open_base,
           count(*) FILTER (WHERE opened)::int AS opened,
           count(*) FILTER (WHERE clicked)::int AS clicked,
           count(*) FILTER (WHERE open_base AND clicked)::int AS opened_clicked,
           count(*) FILTER (WHERE replied)::int AS replied,
           count(*) FILTER (WHERE auto_replied)::int AS auto_replied,
           count(*) FILTER (WHERE step_index = 0 AND accepted)::int AS first_accepted,
           count(*) FILTER (WHERE step_index = 0 AND status = 'sent')::int AS first_sent,
           count(*) FILTER (WHERE step_index = 0 AND status = 'sent' AND seq_hit)::int AS seq_replied,
           count(*) FILTER (WHERE unsubscribed)::int AS unsubscribed,
           count(*) FILTER (WHERE complained)::int AS complained,
           count(*) FILTER (WHERE visited)::int AS visited,
           count(*) FILTER (WHERE acted)::int AS site_actions
    FROM f
    GROUP BY GROUPING SETS ((stat_date, workspace_id),
                            (stat_date, workspace_id, campaign_kind, campaign_id, step_index),
                            (stat_date, workspace_id, partition_id),
                            (stat_date, workspace_id, sender_profile_id, sender_domain),
                            (stat_date, workspace_id, trigger_type))
),
cur AS (SELECT * FROM email_stats_daily d
        WHERE d.org_id = ${orgId}::uuid AND d.grain IN ('total','campaign','partition','sender','trigger')
            AND d.stat_date BETWEEN ${range.from}::date AND ${range.to}::date),
changed AS (SELECT a.* FROM agg a LEFT JOIN cur d USING (grain, stat_date, workspace_id, campaign_kind, campaign_id,
                                                         step_index, partition_id, sender_profile_id, sender_domain,
             trigger_type)
            WHERE d.org_id IS NULL OR (a.total, a.accepted, a.sent, a.failed, a.pending, a.delivered, a.bounced,
             a.bounced_hard, a.sender_side, a.nhn_unsub, a.send_reject, a.unconfirmed, a.open_base, a.opened,
             a.clicked, a.opened_clicked, a.replied, a.auto_replied, a.first_accepted, a.first_sent, a.seq_replied,
             a.unsubscribed, a.complained, a.visited, a.site_actions) IS DISTINCT FROM (d.total, d.accepted,
             d.sent, d.failed, d.pending, d.delivered, d.bounced, d.bounced_hard, d.sender_side, d.nhn_unsub,
             d.send_reject, d.unconfirmed, d.open_base, d.opened, d.clicked, d.opened_clicked, d.replied,
            d.auto_replied, d.first_accepted, d.first_sent, d.seq_replied, d.unsubscribed, d.complained, d.visited,
             d.site_actions)),
ins AS (INSERT INTO email_stats_daily (org_id, grain, stat_date, workspace_id, campaign_kind, campaign_id,
             step_index, partition_id, sender_profile_id, sender_domain, trigger_type, total, accepted, sent,
             failed, pending, delivered, bounced, bounced_hard, sender_side, nhn_unsub, send_reject, unconfirmed,
             open_base, opened, clicked, opened_clicked, replied, auto_replied, first_accepted, first_sent,
             seq_replied, unsubscribed, complained, visited, site_actions, updated_at)
        SELECT ${orgId}::uuid, grain, stat_date, workspace_id, campaign_kind, campaign_id, step_index, partition_id,
             sender_profile_id, sender_domain, trigger_type, total, accepted, sent, failed, pending, delivered,
             bounced, bounced_hard, sender_side, nhn_unsub, send_reject, unconfirmed, open_base, opened, clicked,
             opened_clicked, replied, auto_replied, first_accepted, first_sent, seq_replied, unsubscribed,
             complained, visited, site_actions, now() FROM changed ORDER BY grain, stat_date, workspace_id,
             campaign_kind, campaign_id, step_index, partition_id, sender_profile_id, sender_domain, trigger_type
        ON CONFLICT ON CONSTRAINT email_stats_daily_pkey DO UPDATE SET total = EXCLUDED.total, accepted =
            EXCLUDED.accepted, sent = EXCLUDED.sent, failed = EXCLUDED.failed, pending = EXCLUDED.pending,
             delivered = EXCLUDED.delivered, bounced = EXCLUDED.bounced, bounced_hard = EXCLUDED.bounced_hard,
             sender_side = EXCLUDED.sender_side, nhn_unsub = EXCLUDED.nhn_unsub, send_reject = EXCLUDED.send_reject,
             unconfirmed = EXCLUDED.unconfirmed, open_base = EXCLUDED.open_base, opened = EXCLUDED.opened,
             clicked = EXCLUDED.clicked, opened_clicked = EXCLUDED.opened_clicked, replied = EXCLUDED.replied,
             auto_replied = EXCLUDED.auto_replied, first_accepted = EXCLUDED.first_accepted, first_sent =
            EXCLUDED.first_sent, seq_replied = EXCLUDED.seq_replied, unsubscribed = EXCLUDED.unsubscribed,
             complained = EXCLUDED.complained, visited = EXCLUDED.visited, site_actions = EXCLUDED.site_actions,
             updated_at = EXCLUDED.updated_at
        RETURNING 1),
del AS (DELETE FROM email_stats_daily d
        WHERE d.org_id = ${orgId}::uuid AND d.grain IN ('total','campaign','partition','sender','trigger')
            AND d.stat_date BETWEEN ${range.from}::date AND ${range.to}::date
          AND NOT EXISTS (SELECT 1 FROM agg a WHERE (a.grain, a.stat_date, a.workspace_id, a.campaign_kind,
             a.campaign_id, a.step_index, a.partition_id, a.sender_profile_id, a.sender_domain, a.trigger_type)
            = (d.grain, d.stat_date, d.workspace_id, d.campaign_kind, d.campaign_id, d.step_index, d.partition_id,
             d.sender_profile_id, d.sender_domain, d.trigger_type))
        RETURNING 1)
SELECT (SELECT count(*) FROM ins)::int AS written, (SELECT count(*) FROM del)::int AS deleted;
`;
}
