// 2026-10-22 바꾸기 전 문장 그대로 — 결과 동일 비교의 기준. 결과를 의도적으로 바꾸는 변경이 아니면 고치지 않는다.
import { EMAIL_TRIM_CHARS, contactKindOf, normalizeEmail } from "./deep-visitor-alert-rules";
import { loadJourneyAudience, summarizeJourneyAudience } from "./customer-journey-audience";
import { openPglite, insertRow, type TaggedSql } from "./db/pglite-harness.test-helper";
import * as schema from "./db/schema";
export type Target = Parameters<typeof loadJourneyAudience>[1];
export type AudienceFacts = Parameters<typeof summarizeJourneyAudience>[0];
export function asConnection(tag: TaggedSql): Parameters<typeof loadJourneyAudience>[0] {
    return tag as unknown as Parameters<typeof loadJourneyAudience>[0];
}
export async function legacyJourneyFacts(conn: Parameters<typeof loadJourneyAudience>[0], target: Target, now: Date) {
    const emailKeys = target.fields.filter((f) => contactKindOf(f) === "email").map((f) => f.key);
    const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const [facts] = await conn<AudienceFacts[]>`
        WITH own AS (
            SELECT w.org_id, w.id AS workspace_id, site.id AS site_id
            FROM workspaces w JOIN tracker_sites site ON site.workspace_id = w.id AND site.org_id = w.org_id
            WHERE w.id = ${target.workspaceId} AND w.org_id = ${target.orgId} AND site.id = ${target.session.siteId}
        ), visits AS MATERIALIZED (
            SELECT s.* FROM tracker_sessions s JOIN own ON own.site_id = s.site_id
            WHERE s.visitor_id = ${target.session.visitorId} AND s.started_at >= ${since} AND s.started_at <= ${now.toISOString()}
        ), links AS MATERIALIZED (
            SELECT DISTINCT l.record_id, l.recipient_email AS email, c.click_id
            FROM visits v JOIN email_click_logs c ON c.click_id = v.click_id
            JOIN own ON own.org_id = c.org_id
            JOIN email_send_logs l ON l.id = c.send_log_id AND l.org_id = own.org_id
            JOIN records r ON r.id = l.record_id AND r.workspace_id = own.workspace_id AND r.org_id = own.org_id
        ), identities AS (
            SELECT v.record_id FROM tracker_visitors v JOIN own ON own.org_id = v.org_id AND own.site_id = v.site_id
                WHERE v.id = ${target.session.visitorId} AND v.record_id IS NOT NULL
            UNION SELECT l.record_id FROM visitor_record_links l JOIN own ON own.org_id = l.org_id
                WHERE l.visitor_id = ${target.session.visitorId}
        ), related AS MATERIALIZED (
            SELECT r.id, r.data FROM records r JOIN own ON own.workspace_id = r.workspace_id AND own.org_id = r.org_id
            WHERE r.id = ${target.recordId} OR r.id IN (SELECT record_id FROM links) OR r.id IN (SELECT record_id FROM identities)
               OR EXISTS (SELECT 1 FROM unnest(${emailKeys}::text[]) AS k(key)
                    WHERE lower(btrim(r.data->>k.key, ${EMAIL_TRIM_CHARS})) = ${normalizeEmail(target.recipientEmail)})
        ), funnel AS (
            SELECT f.stages FROM tracker_funnels f JOIN own ON own.site_id = f.site_id AND own.org_id = f.org_id
            WHERE f.kind = 'marketing' AND f.is_default = 1 ORDER BY f.created_at DESC LIMIT 1
        )
        SELECT (SELECT COUNT(*) = 1 FROM own) AS authorized,
            COALESCE((SELECT json_agg(email) FROM (
                SELECT u.email FROM users u JOIN own ON own.org_id = u.org_id
                UNION SELECT u.email FROM organization_members m JOIN own ON own.org_id = m.organization_id JOIN users u ON u.id = m.user_id
                UNION SELECT p.from_email FROM email_sender_profiles p JOIN own ON own.org_id = p.org_id
            ) AS emails), '[]'::json) AS "internalEmails",
            COALESCE((SELECT json_agg(email) FROM (
                SELECT r.data->>k.key AS email FROM related r, unnest(${emailKeys}::text[]) AS k(key) WHERE r.data->>k.key IS NOT NULL
                UNION SELECT v.email FROM tracker_visitors v JOIN own ON own.org_id = v.org_id AND own.site_id = v.site_id
                    WHERE v.id = ${target.session.visitorId} AND v.email IS NOT NULL
            ) AS emails), '[]'::json) AS "identifiedEmails",
            COALESCE((SELECT json_agg(json_build_object('recordId', record_id, 'email', email, 'clickId', click_id)) FROM links), '[]'::json) AS links,
            COALESCE((SELECT json_agg(json_build_object('id', id, 'siteId', site_id, 'visitorId', visitor_id,
                'startedAt', started_at, 'endedAt', ended_at, 'duration', duration, 'pageCount', page_count, 'clickId', click_id)) FROM visits), '[]'::json) AS sessions,
            COALESCE((SELECT json_agg(json_build_object('data', data)) FROM related), '[]'::json) AS "relatedRecords",
            COALESCE((SELECT json_agg(json_build_object('field', st->'match'->>'field', 'value', st->'match'->>'value'))
                FROM funnel, jsonb_array_elements(funnel.stages) st WHERE st->'match'->>'type' = 'record_field'), '[]'::json) AS "funnelStages",
            COALESCE((SELECT json_agg(json_build_object('type', e.type, 'label', e.label)) FROM record_events e
                JOIN related r ON r.id = e.record_id JOIN own ON own.org_id = e.org_id WHERE e.occurred_at <= ${now.toISOString()}), '[]'::json) AS "recordEvents",
            COALESCE((SELECT json_agg(json_build_object('eventType', e.event_type, 'eventName', e.event_name, 'pageUrl', e.page_url))
                FROM tracker_events e JOIN visits v ON v.id = e.session_id AND v.site_id = e.site_id
                WHERE e.occurred_at <= ${now.toISOString()} AND (e.event_type = 'PURCHASE'
                    OR (e.event_type IN ('CLICK', 'CUSTOM') AND e.event_name ~* '(subscribe_submit|signup_complete)')
                    OR (e.event_type = 'PAGE_VIEW' AND e.page_url ~ '/(signup/complete|main/)'))), '[]'::json) AS "completionEvents",
            EXISTS (SELECT 1 FROM email_unsubscribes u JOIN own ON own.org_id = u.org_id
                WHERE u.record_id IN (SELECT id FROM related)
                    OR lower(btrim(u.email, ${EMAIL_TRIM_CHARS})) = ${normalizeEmail(target.recipientEmail)}) AS unsubscribed,
            GREATEST(${target.session.startedAt.toISOString()}::timestamptz,
                (SELECT MAX(LEAST(COALESCE(v.ended_at, v.started_at), ${now.toISOString()})) FROM visits v),
                (SELECT MAX(e.occurred_at) FROM tracker_events e JOIN visits v ON v.id = e.session_id AND v.site_id = e.site_id
                    WHERE e.occurred_at <= ${now.toISOString()})) AS "lastActivityAt"
    `;
    return facts;
}
export const fixtureNow = new Date("2026-10-22T00:00:00Z");
export const fixtureEmail = "kim@sample.co.kr";
export const longEmail = "a".repeat(240) + "@sample.kr";
const org = "00000000-0000-4000-8000-000000000001";
const otherOrg = "00000000-0000-4000-8000-000000000002";
export function journeyTarget(keys: string[], recipientEmail = fixtureEmail): Target {
    return { orgId: org, workspaceId: 8, recordId: 100, recipientEmail,
        sentAt: new Date("2026-10-21T23:00:00Z"),
        session: { id: 50, siteId: 2, visitorId: 5, startedAt: new Date("2026-10-21T23:30:00Z"),
            endedAt: fixtureNow, duration: 1800, pageCount: 2, clickId: "fixture-click" },
        fields: keys.map(key => ({ key, label: key === "work_email" ? "업무 메일" : "이메일", fieldType: key === "work_email" ? "text" : "email", value: fixtureEmail })) };
}
export function canonical(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
}
export async function journeyFixture() {
    const pg = await openPglite([schema.workspaces, schema.trackerSites, schema.trackerSessions, schema.trackerVisitors,
        schema.visitorRecordLinks, schema.trackerEvents, schema.trackerFunnels, schema.emailSendLogs, schema.emailClickLogs,
        schema.emailUnsubscribes, schema.emailSenderProfiles, schema.records, schema.recordEvents, schema.users, schema.organizationMembers]);
    try {
        for (const id of [8, 9, 10]) await insertRow(pg, "workspaces", { id, org_id: id === 10 ? otherOrg : org, name: `fixture-${id}` });
        await insertRow(pg, "tracker_sites", { id: 2, org_id: org, workspace_id: 8, name: "fixture", api_key: "fixture" });
        const values: Record<string, unknown>[] = [{ email: "KIM@SAMPLE.CO.KR" },
            ...[...EMAIL_TRIM_CHARS].map(c => ({ email: c + c + fixtureEmail + c })),
            { email: "ki m@sample.co.kr" }, { email: "\u2002" + fixtureEmail + "\u2002" }, { email: 12345 },
            { email: [fixtureEmail] }, { email: null }, { work_email: fixtureEmail },
            { email: fixtureEmail }, { email: fixtureEmail }, { email: fixtureEmail },
            { email: longEmail }, { email: longEmail.slice(0, 200) + "different@sample.kr" },
            { email: "link@fixture.test" }, { email: "identity@fixture.test" }, { email: "visitor-link@fixture.test" }, { email: "　" }];
        for (const [i, data] of values.entries()) {
            const id = i + 1;
            await insertRow(pg, "records", { id, org_id: id === 19 || id === 20 ? otherOrg : org,
                workspace_id: id === 18 ? 9 : id === 19 ? 10 : 8, partition_id: 1, data: JSON.stringify({ ...data, _fixture: `R${id}` }) });
        }
        await insertRow(pg, "records", { id: 100, org_id: org, workspace_id: 8, partition_id: 1, data: JSON.stringify({ email: "target@fixture.test", _fixture: "T" }) });
        await insertRow(pg, "tracker_visitors", { id: 5, org_id: org, site_id: 2, visitor_id: "fixture-visitor", record_id: 24, email: "identity@fixture.test" });
        await insertRow(pg, "visitor_record_links", { org_id: org, visitor_id: 5, record_id: 25 });
        await insertRow(pg, "email_send_logs", { id: 1, org_id: org, record_id: 23, recipient_email: "link@fixture.test", subject: "fixture", status: "sent" });
        await insertRow(pg, "email_click_logs", { org_id: org, send_log_id: 1, click_id: "fixture-click", url: "https://fixture.test" });
        await insertRow(pg, "tracker_sessions", { id: 50, site_id: 2, visitor_id: 5, session_key: "fixture-session", click_id: "fixture-click",
            started_at: journeyTarget([]).session.startedAt.toISOString(), ended_at: fixtureNow.toISOString(), duration: 1800, page_count: 2 });
        await insertRow(pg, "tracker_funnels", { org_id: org, site_id: 2, name: "fixture", kind: "marketing", is_default: 1,
            stages: JSON.stringify([{ match: { type: "record_field", field: "stage", value: "converted" } }]) });
        await insertRow(pg, "record_events", { org_id: org, record_id: 1, type: "signup", label: "converted", occurred_at: fixtureNow.toISOString() });
        await insertRow(pg, "email_unsubscribes", { org_id: org, workspace_id: 8, record_id: 1, email: fixtureEmail });
        await insertRow(pg, "users", { org_id: org, name: "fixture", email: "internal@fixture.test", password: "fixture" });
        return pg;
    } catch (error) {
        await pg.close();
        throw error;
    }
}
