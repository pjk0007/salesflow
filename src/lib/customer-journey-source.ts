/** 고객 여정 워커와 CRM이 같은 원본·고객 구분을 읽는다. */
import type { queryClient } from "./db";
import type { JourneyCardInput } from "./customer-journey-card";
import type { EventInput } from "./deep-visitor-alert-rules";
import { loadJourneyAudience } from "./customer-journey-audience";
import type { JourneyCohortMember } from "./customer-journey-priority";
type Connection = Awaited<ReturnType<typeof queryClient.reserve>>;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

export interface CandidateRow {
    org_id: string; workspace_id: number; business_name: string;
    record_id: number; integrated_code: string | null; data: Record<string, unknown> | string;
    recipient_email: string; subject: string | null; sent_at: Date; clicked_at: Date;
    session_id: number; site_id: number; visitor_id: number; started_at: Date; ended_at: Date | null;
    duration: number | null; page_count: number | null; click_id: string;
    fields: { key: string; label: string; field_type: string }[];
    labels: { event_type: string; event_name: string; label: string }[];
    events: { sessionId: number; eventType: string; eventName: string | null; pageUrl: string | null; pageTitle: string | null; occurredAt: string; properties: Record<string, unknown> | null }[];
}
/** 같은 조직·사업의 메일 클릭에 직접 연결된 방문만 모은다. 이미 보낸 방문은 후보에서 뺀다. */
export async function loadCandidates(conn: Connection, workspaceId: number, now: Date, since: Date, existing?: { sessionId: number; orgId: string }): Promise<CandidateRow[]> {
    return conn<CandidateRow[]>`
        SELECT w.org_id, w.id AS workspace_id, w.name AS business_name,
               r.id AS record_id, r.integrated_code, r.data,
               l.recipient_email, l.subject, l.sent_at, c.clicked_at,
               s.id AS session_id, s.site_id, s.visitor_id, s.started_at, s.ended_at, s.duration, s.page_count, s.click_id,
               COALESCE((SELECT json_agg(json_build_object('key', f.key, 'label', f.label, 'field_type', f.field_type) ORDER BY f.sort_order, f.id)
                   FROM field_definitions f WHERE f.workspace_id = w.id OR f.field_type_id = COALESCE(p.field_type_id, w.default_field_type_id)), '[]'::json) AS fields,
               COALESCE((SELECT json_agg(json_build_object('event_type', a.event_type, 'event_name', a.event_name, 'label', a.label))
                   FROM tracker_event_aliases a WHERE a.site_id = site.id AND a.org_id = w.org_id), '[]'::json) AS labels,
               COALESCE((SELECT json_agg(json_build_object('sessionId', e.session_id, 'eventType', e.event_type, 'eventName', e.event_name,
                   'pageUrl', e.page_url, 'pageTitle', e.page_title, 'occurredAt', e.occurred_at, 'properties', e.properties) ORDER BY e.occurred_at, e.id)
                   FROM tracker_events e WHERE e.session_id = s.id AND e.site_id = site.id AND e.occurred_at <= ${now.toISOString()}), '[]'::json) AS events
        FROM workspaces w
        JOIN tracker_sites site ON site.workspace_id = w.id AND site.org_id = w.org_id AND site.is_active = 1
        JOIN tracker_sessions s ON s.site_id = site.id
        JOIN email_click_logs c ON c.click_id = s.click_id AND c.org_id = w.org_id
        JOIN email_send_logs l ON l.id = c.send_log_id AND l.org_id = w.org_id AND l.status = 'sent'
        JOIN records r ON r.id = l.record_id AND r.workspace_id = w.id AND r.org_id = w.org_id
        JOIN partitions p ON p.id = r.partition_id AND p.workspace_id = w.id
        WHERE w.id = ${workspaceId}
          AND (${existing?.sessionId ?? null}::int IS NULL OR (s.id = ${existing?.sessionId ?? null} AND w.org_id = ${existing?.orgId ?? null}::uuid))
          AND s.started_at >= ${since.toISOString()} AND s.started_at <= ${now.toISOString()}
          AND c.clicked_at <= ${now.toISOString()}
          AND (${existing !== undefined} OR GREATEST(s.started_at, COALESCE(s.ended_at, s.started_at),
              COALESCE((SELECT MAX(e.occurred_at) FROM tracker_events e WHERE e.session_id = s.id AND e.site_id = s.site_id AND e.occurred_at <= ${now.toISOString()}), s.started_at))
              <= ${new Date(now.getTime() - 10 * 60 * 1000).toISOString()})
          AND (${existing !== undefined} OR NOT EXISTS (SELECT 1 FROM customer_journey_alerts a WHERE a.session_id = s.id AND a.org_id = w.org_id))
        ORDER BY s.started_at, s.id
        LIMIT ${BATCH_SIZE}
    `;
}

export async function loadCohort(conn: Connection, workspaceId: number, now: Date): Promise<JourneyCohortMember[]> {
    const rows = await conn<{ customer_key: string; score: string | number }[]>`
        SELECT a.message->'journeyPriority'->>'customerKey' AS customer_key,
               MAX((a.message->'journeyPriority'->>'score')::numeric) AS score
        FROM customer_journey_alerts a JOIN workspaces w ON w.id = a.workspace_id AND w.org_id = a.org_id
        WHERE a.workspace_id = ${workspaceId} AND a.created_at >= ${new Date(now.getTime() - 30 * DAY_MS).toISOString()} AND a.created_at <= ${now.toISOString()}
          AND a.message->'journeyPriority'->>'version' = '1' AND a.message->'journeyPriority'->>'rankEligible' = 'true'
          AND jsonb_typeof(a.message->'journeyPriority'->'score') = 'number'
        GROUP BY a.message->'journeyPriority'->>'customerKey'`;
    return rows.map((r) => ({ customerKey: r.customer_key, score: Number(r.score) }));
}

export async function enrichedInput(conn: Connection, row: CandidateRow, baseUrl: string, now: Date, cohort: readonly JourneyCohortMember[], internalDomains: string[]) {
    const input = cardInput(row, baseUrl);
    input.cohort = cohort;
    input.audience = await loadJourneyAudience(conn, { orgId: row.org_id, workspaceId: row.workspace_id,
        recordId: row.record_id, recipientEmail: row.recipient_email, sentAt: input.sentAt, session: input.session, fields: input.fields }, now, internalDomains);
    return input;
}

export function cardInput(row: CandidateRow, baseUrl: string): JourneyCardInput {
    const events: EventInput[] = row.events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) }));
    // Drizzle가 공유 postgres 클라이언트의 jsonb 자동 변환을 끄므로 raw 조회의 jsonb는 문자열일 수 있다.
    const data = typeof row.data === "string" ? JSON.parse(row.data) as Record<string, unknown> : row.data;
    return {
        recordId: row.record_id, integratedCode: row.integrated_code, businessName: row.business_name,
        recipientEmail: row.recipient_email, subject: row.subject,
        sentAt: new Date(row.sent_at), clickedAt: new Date(row.clicked_at),
        session: { id: row.session_id, siteId: row.site_id, visitorId: row.visitor_id,
            startedAt: new Date(row.started_at), endedAt: row.ended_at ? new Date(row.ended_at) : null,
            duration: row.duration, pageCount: row.page_count, clickId: row.click_id },
        events, fields: row.fields.filter((f) => !f.key.startsWith("_") && f.field_type !== "file")
            .map((f) => ({ key: f.key, label: f.label, fieldType: f.field_type, value: String(data?.[f.key] ?? "") })).filter((f) => f.value.trim()),
        labels: Object.fromEntries(row.labels.map((a) => [`${a.event_type}:${a.event_name}`, a.label])), baseUrl,
    };
}
