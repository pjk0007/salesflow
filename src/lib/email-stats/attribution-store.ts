import { resolveAttribution, type SendAttrInput, type ParentAttr } from "./attribution";
import { ruleOf } from "../email-reply-rules";
import { kstDayBounds, type DateRange } from "./rules";
import type { StatsConn } from "./connection";

export async function fillAttribution(conn: StatsConn, orgId: string, range: DateRange): Promise<number> {
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    const rows = await conn.unsafe<SendAttrInput[]>(
        `SELECT l.id,l.org_id AS "orgId",(l.sent_at AT TIME ZONE 'Asia/Seoul')::date::text AS "statDate",
        p.workspace_id AS "workspaceId",l.partition_id AS "partitionId",l.trigger_type AS "triggerType",l.parent_log_id
            AS "parentLogId",
        l.auto_personalized_link_id AS "autoPersonalizedLinkId",l.template_link_id AS "templateLinkId",l.email_template_id
            AS "emailTemplateId",
        l.sender_profile_id AS "senderProfileId",lower(split_part(COALESCE(l.sender_email,''),'@',2)) AS "senderDomain"
        FROM email_send_logs l LEFT JOIN partitions p ON p.id=l.partition_id
        WHERE l.org_id=$1 AND l.sent_at >= $2 AND l.sent_at < $3
        AND NOT EXISTS(SELECT 1 FROM email_stats_send_attr a WHERE a.send_log_id=l.id) ORDER BY l.id`,
        [orgId, fromIso, toIso]
    );
    if (!rows.length)
        return 0;
    const rowIds = new Set(rows.map(row => row.id));
    const ids = [
        ...new Set(rows.flatMap(row => row.parentLogId !== null && !rowIds.has(row.parentLogId) ? [row.parentLogId] : []))
    ];
    const parents = new Map<number, ParentAttr | "missing">();
    if (ids.length) {
        const saved = await conn.unsafe<ParentAttr[]>(
            `SELECT send_log_id AS "sendLogId",org_id AS "orgId",root_log_id AS "rootLogId",step_index AS "stepIndex",
            campaign_kind AS "campaignKind",campaign_id AS "campaignId" FROM email_stats_send_attr WHERE send_log_id=ANY($1::int[])
            AND org_id=$2`,
            [ids, orgId]
        );
        for (const row of saved)
            parents.set(row.sendLogId, row);
        const missing = ids.filter(id => !parents.has(id));
        if (missing.length) {
            const chains = await conn.unsafe<(ParentAttr & {
                autoPersonalizedLinkId: number | null;
                templateLinkId: number | null;
                emailTemplateId: number | null;
            })[]>(
                `WITH RECURSIVE chain AS (
                SELECT l.id AS start_id,l.id,l.parent_log_id,l.org_id,0 AS depth FROM email_send_logs l WHERE
            l.id=ANY($1::int[]) AND l.org_id=$2
                UNION ALL SELECT c.start_id,p.id,p.parent_log_id,p.org_id,c.depth+1 FROM chain c JOIN email_send_logs
            p ON p.id=c.parent_log_id AND p.org_id=c.org_id WHERE c.depth<10)
                SELECT DISTINCT ON(c.start_id) c.start_id AS "sendLogId",c.org_id AS "orgId",c.id AS "rootLogId",
            c.depth AS "stepIndex",
                r.auto_personalized_link_id AS "autoPersonalizedLinkId",r.template_link_id AS "templateLinkId",
            r.email_template_id AS "emailTemplateId"
                FROM chain c JOIN email_send_logs r ON r.id=c.id ORDER BY c.start_id,c.depth DESC`,
                [missing, orgId]
            );
            for (const row of chains) {
                const rule = ruleOf(row);
                parents.set(
                    row.sendLogId,
                    {
                        sendLogId: row.sendLogId,
                        orgId: row.orgId,
                        rootLogId: row.rootLogId,
                        stepIndex: row.stepIndex,
                        campaignKind: rule.kind,
                        campaignId: rule.id ?? row.emailTemplateId ?? 0
                    }
                );
            }
            for (const id of missing)
                if (!parents.has(id))
                    parents.set(id, "missing");
        }
    }
    const attrs = resolveAttribution(rows, parents);
    let inserted = 0;
    for (let offset = 0;offset < attrs.length;offset += 1000) {
        const batch = attrs.slice(offset, offset + 1000);
        const result = await conn.unsafe(
            `INSERT INTO email_stats_send_attr(send_log_id,org_id,stat_date,workspace_id,partition_id,trigger_type,campaign_kind,
            campaign_id,root_log_id,step_index,sender_profile_id,sender_domain)
            SELECT "sendLogId","orgId","statDate","workspaceId","partitionId","triggerType","campaignKind",
            "campaignId","rootLogId","stepIndex","senderProfileId","senderDomain"
            FROM jsonb_to_recordset($1::text::jsonb) AS x("sendLogId" int,"orgId" uuid,"statDate" date,"workspaceId"
            int,"partitionId" int,"triggerType" text,"campaignKind" text,"campaignId" int,"rootLogId" int,
            "stepIndex" smallint,"senderProfileId" int,"senderDomain" text)
            ON CONFLICT(send_log_id) DO NOTHING RETURNING send_log_id`,
            [JSON.stringify(batch)]
        );
        inserted += result.length;
    }
    return inserted;
}
