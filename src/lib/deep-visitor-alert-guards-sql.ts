import { RECORD_EMAIL_KEY, RECORD_EMAIL_PREFIX, recordEmailIndexKeySql } from "./db/records-email-index";
import { sql, type SQL } from "drizzle-orm";
import { emailPairsByKey } from "./deep-visitor-alert-batch";
import { EMAIL_TRIM_CHARS } from "./deep-visitor-alert-rules";
export interface AudienceGuardsSqlInput {
    orgId: string; visitorIds: number[]; itemRecordIds: number[];
    allEmails: string[]; allStageValues: string[];
    specs: Array<{ workspaceId: number; keys: string[]; emails: string[] }>;
}
export interface AudienceGuardsRow {
    linked: Array<{ visitor_id: number; record_id: number | null }> | null;
    unsub: Array<{ record_id: number | null; workspace_id: number | null; email: string | null }> | null;
    records: GuardRecordJson[] | null;
    funnel_events: Array<{ record_id: number; type: string | null; label: string | null }> | null;
}
export interface GuardRecordJson {
    id: number;
    workspace_id: number;
    partition_id: number;
    integrated_code: string | null;
    created_at: string;
    data: Record<string, unknown> | null;
    email_match: boolean | null;
}

function pairsMatchSql(alias: "r" | "ro", pairs: ReturnType<typeof emailPairsByKey>): SQL {
    const parts = [...pairs].map(([key, p]) => sql`
        (${sql.raw(alias + ".workspace_id")}, lower(btrim(${sql.raw(alias + ".data")}->>${key}::text, ${EMAIL_TRIM_CHARS}::text))) IN (
            SELECT * FROM unnest(${sql.param(p.ws)}::int[], ${sql.param(p.emails)}::text[])
        )`);
    return parts.length === 0 ? sql`false` : sql.join(parts, sql` OR `);
}

/** 결과 4칸은 변경 전과 같다. records는 id 순이다. */
export function audienceGuardsSql(input: AudienceGuardsSqlInput): SQL {
    const { orgId, visitorIds, itemRecordIds, allEmails, allStageValues, specs } = input;
    const pairs = emailPairsByKey(specs);
    const indexed = pairs.get(RECORD_EMAIL_KEY);
    const others = new Map([...pairs].filter(([key]) => key !== RECORD_EMAIL_KEY));
    const emailMatch = pairsMatchSql("r", pairs);
    const indexedBranch = indexed ? sql`
          UNION ALL SELECT rm.id
              FROM unnest(${sql.param(indexed.ws)}::int[], ${sql.param(indexed.emails)}::text[]) AS p(ws, email)
              JOIN records rm ON rm.workspace_id = p.ws
               AND ${sql.raw(recordEmailIndexKeySql("rm.data"))} = left(p.email, ${sql.raw(String(RECORD_EMAIL_PREFIX))})
               AND lower(btrim(rm.data->>${RECORD_EMAIL_KEY}::text, ${EMAIL_TRIM_CHARS}::text)) = p.email` : sql.empty();
    const otherBranch = others.size > 0 ? sql`
          UNION ALL SELECT ro.id FROM records ro
              WHERE ro.org_id = ${orgId}::uuid AND (${pairsMatchSql("ro", others)})` : sql.empty();
    return sql`
        WITH linked AS MATERIALIZED (
            SELECT v.id AS visitor_id, v.record_id, 0 AS src, 0 AS ord
            FROM tracker_visitors v
            WHERE v.id = ANY(${sql.param(visitorIds)}::int[]) AND v.org_id = ${orgId}::uuid AND v.record_id IS NOT NULL
            UNION ALL
            SELECT l.visitor_id, l.record_id, 1 AS src, l.id AS ord
            FROM visitor_record_links l
            WHERE l.visitor_id = ANY(${sql.param(visitorIds)}::int[]) AND l.org_id = ${orgId}::uuid
        ),
        unsub AS (
            SELECT u.record_id, u.workspace_id, u.email
            FROM email_unsubscribes u
            WHERE u.org_id = ${orgId}::uuid
              AND (u.record_id = ANY(${sql.param(itemRecordIds)}::int[])
                   OR lower(btrim(u.email, ${EMAIL_TRIM_CHARS}::text)) = ANY(${sql.param(allEmails)}::text[]))
        ),
        grec AS MATERIALIZED (
            SELECT r.id, r.workspace_id, r.partition_id, r.integrated_code, r.created_at, r.data,
                   (${emailMatch}) AS email_match
            FROM records r
            WHERE r.org_id = ${orgId}::uuid
              AND r.id = ANY(ARRAY(
                  SELECT unnest(${sql.param(itemRecordIds)}::int[])
                  UNION ALL SELECT record_id FROM linked
                  ${indexedBranch}
                  ${otherBranch}
              ))
        ),
        fev AS (
            SELECT DISTINCT e.record_id, e.type, e.label
            FROM record_events e
            WHERE cardinality(${sql.param(allStageValues)}::text[]) > 0
              AND e.org_id = ${orgId}::uuid
              AND e.record_id IN (SELECT id FROM grec)
              AND (e.type = 'signup' OR e.label = ANY(${sql.param(allStageValues)}::text[]))
        )
        SELECT (SELECT COALESCE(json_agg(json_build_object('visitor_id', visitor_id, 'record_id', record_id) ORDER BY src, ord), '[]'::json) FROM linked) AS linked,
               (SELECT COALESCE(json_agg(unsub), '[]'::json) FROM unsub) AS unsub,
               (SELECT COALESCE(json_agg(grec ORDER BY grec.id), '[]'::json) FROM grec) AS records,
               (SELECT COALESCE(json_agg(fev), '[]'::json) FROM fev) AS funnel_events
    `;
}
