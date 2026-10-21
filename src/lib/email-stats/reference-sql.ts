import { sql, type SQL } from "drizzle-orm";
import { openBaseSql, openedSendSql } from "../email-open-sql";
import { HEALTH_CATEGORY_SQL } from "../sender-health-rules";
import { kstDayBounds, type DateRange } from "./rules";
/** QA 전용 원본 직접 집계. 저장된 귀속·집계 표는 읽지 않는다. */
export function referenceSql(orgId: string, range: DateRange, accepted: SQL): SQL {
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    return sql`WITH RECURSIVE chain AS (
    SELECT l.id AS start_id, l.id, l.parent_log_id, l.org_id, 0 AS depth
    FROM email_send_logs l WHERE l.org_id = ${orgId}::uuid
    UNION ALL
    SELECT c.start_id, p.id, p.parent_log_id, p.org_id, c.depth + 1
    FROM chain c JOIN email_send_logs p ON p.id = c.parent_log_id AND p.org_id = c.org_id
    WHERE c.depth < 10
), roots AS (
    SELECT DISTINCT ON (start_id) start_id, id, depth FROM chain ORDER BY start_id, depth DESC
), source_attr AS (
    SELECT l.id AS send_log_id, l.org_id, (l.sent_at AT TIME ZONE 'Asia/Seoul')::date AS stat_date,
        COALESCE(p.workspace_id,0) AS workspace_id, COALESCE(l.partition_id,0) AS partition_id,
        COALESCE(l.trigger_type,'') AS trigger_type, COALESCE(l.sender_profile_id,0) AS sender_profile_id,
        lower(split_part(COALESCE(l.sender_email,''),'@',2)) AS sender_domain,
        r.id AS root_log_id, r.depth AS step_index,
        CASE WHEN root.auto_personalized_link_id IS NOT NULL THEN 'ai' WHEN root.template_link_id IS NOT NULL
            THEN 'template' ELSE 'manual' END AS campaign_kind,
        COALESCE(root.auto_personalized_link_id,root.template_link_id,root.email_template_id,0) AS campaign_id
    FROM email_send_logs l JOIN roots r ON r.start_id=l.id
    JOIN email_send_logs root ON root.id=r.id LEFT JOIN partitions p ON p.id=l.partition_id
    WHERE l.org_id=${orgId}::uuid
), s AS (       
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
        FROM email_replies r LEFT JOIN source_attr ra ON ra.send_log_id = r.send_log_id
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
    JOIN source_attr a ON a.send_log_id = l.id AND a.org_id = ${orgId}::uuid AND a.stat_date BETWEEN ${range.from}::date
            AND ${range.to}::date
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
)
SELECT * FROM agg;`;
}
