// 2026-10-22 바꾸기 전 문장 그대로 — 결과 동일 비교의 기준. 결과를 의도적으로 바꾸는 변경이 아니면 고치지 않는다.
import { sql, type SQL } from "drizzle-orm";
import { emailPairsByKey } from "./deep-visitor-alert-batch";
import { EMAIL_TRIM_CHARS } from "./deep-visitor-alert-rules";
import type { AudienceGuardsSqlInput } from "./deep-visitor-alert-guards-sql";
function sameEmailSql(specs: Array<{ workspaceId: number; keys: string[]; emails: string[] }>): SQL {
    const parts = [...emailPairsByKey(specs)].map(([key, p]) => sql`
        (r.workspace_id, lower(btrim(r.data->>${key}::text, ${EMAIL_TRIM_CHARS}::text))) IN (
            SELECT * FROM unnest(${sql.param(p.ws)}::int[], ${sql.param(p.emails)}::text[])
        )`);
    return parts.length === 0 ? sql`false` : sql.join(parts, sql` OR `);
}

export function legacyAudienceGuardsSql(input: AudienceGuardsSqlInput): SQL {
    const { orgId, visitorIds, itemRecordIds, allEmails, allStageValues, specs } = input;
    const emailMatch = sameEmailSql(specs);
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
              AND (r.id = ANY(${sql.param(itemRecordIds)}::int[])
                   OR r.id IN (SELECT record_id FROM linked)
                   OR (${emailMatch}))
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

import { openPglite, insertRow } from "./db/pglite-harness.test-helper";
import { records, trackerVisitors, visitorRecordLinks, emailUnsubscribes, recordEvents } from "./db/schema";
export const guardOrg = "00000000-0000-4000-8000-000000000001";
export const guardLongEmail = "a".repeat(240) + "@sample.kr";
export function guardInput(): AudienceGuardsSqlInput {
    return { orgId: guardOrg, visitorIds: [5], itemRecordIds: [100, 5],
        allEmails: ["kim@x", "lee@y"], allStageValues: ["converted"],
        specs: [{ workspaceId: 8, keys: ["email"], emails: ["kim@x"] }, { workspaceId: 9, keys: ["email", "work_email"], emails: ["lee@y"] }] };
}
export async function guardFixture() {
    const pg = await openPglite([records, trackerVisitors, visitorRecordLinks, emailUnsubscribes, recordEvents]);
    try {
        const values: [number, number, Record<string, unknown>][] = [
            [1, 8, { email: "kim@x" }], [2, 9, { email: "kim@x" }], [3, 8, { email: "lee@y" }],
            [4, 9, { work_email: "lee@y" }], [5, 10, { email: "kim@x" }],
            [6, 8, { email: "\tKIM@X　" }], [7, 8, { email: guardLongEmail }],
            [8, 8, { email: guardLongEmail.slice(0, 200) + "different@x" }],
            [23, 8, {}], [24, 8, {}], [100, 8, {}]];
        for (const [id, workspace, data] of values) await insertRow(pg, "records", {
            id, workspace_id: workspace, partition_id: 1, data: JSON.stringify(data),
            org_id: id === 5 ? "00000000-0000-4000-8000-000000000002" : guardOrg });
        await insertRow(pg, "tracker_visitors", { id: 5, org_id: guardOrg, site_id: 2, visitor_id: "fixture", record_id: 23 });
        await insertRow(pg, "visitor_record_links", { org_id: guardOrg, visitor_id: 5, record_id: 24 });
        await insertRow(pg, "email_unsubscribes", { org_id: guardOrg, workspace_id: 8, record_id: 100, email: "kim@x" });
        await insertRow(pg, "record_events", { org_id: guardOrg, record_id: 1, type: "signup", label: "signup" });
        await insertRow(pg, "record_events", { org_id: guardOrg, record_id: 4, type: "stage_change", label: "converted" });
        return pg;
    } catch (error) { await pg.close(); throw error; }
}
