/** 고객별 내부·공유 브라우저·전환 여부를 생성 시와 전송 직전에 같은 방식으로 확인한다. */
import { splitEmailKeys } from "./db/records-email-index";
import type { queryClient } from "./db";
import { EMAIL_TRIM_CHARS, contactKindOf, isFunnelRecordEvent, isRecordInFunnel, isSubmitSignal, normalizeEmail, type FunnelFieldStage, type SessionInput } from "./deep-visitor-alert-rules";
import type { JourneyAudience } from "./customer-journey-priority";

type Connection = Awaited<ReturnType<typeof queryClient.reserve>>;
interface AudienceFacts {
    authorized: boolean;
    internalEmails: string[];
    identifiedEmails: string[];
    links: { recordId: number; email: string; clickId: string }[];
    sessions: SessionInput[];
    relatedRecords: { data: Record<string, unknown> }[];
    funnelStages: FunnelFieldStage[];
    recordEvents: { type: string | null; label: string | null }[];
    completionEvents: { eventType: string; eventName: string | null; pageUrl: string | null }[];
    unsubscribed: boolean;
    lastActivityAt: string;
}
export function isJourneyInternalEmail(email: string, knownEmails: readonly string[], extraDomains: readonly string[] = []): boolean {
    const e = normalizeEmail(email);
    const domain = e.split("@")[1] ?? "";
    const internalDomains = ["matchesplan.com", "matchesplan.cloud", ...extraDomains.map((s) => s.trim().toLowerCase().replace(/^@/, ""))];
    return knownEmails.some((v) => normalizeEmail(v) === e) || internalDomains.some((d) => d && (domain === d || domain.endsWith(`.${d}`)));
}
export function summarizeJourneyAudience(facts: AudienceFacts, target: {
    recipientEmail: string; recordId: number; sentAt: Date; session: SessionInput;
}, now: Date, extraDomains: readonly string[] = []): JourneyAudience {
    const email = normalizeEmail(target.recipientEmail);
    const links = facts.links;
    const visitorEmails = [email, ...links.map((l) => l.email), ...facts.identifiedEmails];
    const internal = visitorEmails.some((e) => isJourneyInternalEmail(e, facts.internalEmails, extraDomains));
    const sharedVisitor = new Set(visitorEmails.map(normalizeEmail).filter(Boolean)).size > 1;
    const ownClickIds = new Set(links.filter((l) => l.recordId === target.recordId || normalizeEmail(l.email) === email).map((l) => l.clickId));
    const sessions = facts.sessions.filter((s) => s.siteId === target.session.siteId && s.visitorId === target.session.visitorId && new Date(s.startedAt) <= now);
    const existingVisitor = sessions.filter((s) => new Date(s.startedAt).getTime() < target.sentAt.getTime() - 60_000 && !ownClickIds.has(s.clickId ?? "")).length >= 3;
    const revisit = sessions.some((s) => s.id !== target.session.id && ownClickIds.has(s.clickId ?? "")
        && target.session.startedAt.getTime() - new Date(s.startedAt).getTime() >= 30 * 60_000);
    const stageValues = facts.funnelStages.map((s) => s.value);
    const funnelEvent = facts.recordEvents.some((e) => isFunnelRecordEvent(e, stageValues));
    const alreadyConverted = facts.completionEvents.some((e) => e.eventType === "PURCHASE" || isSubmitSignal(e))
        || facts.relatedRecords.some((r) => isRecordInFunnel(facts.funnelStages, r.data, funnelEvent));
    const lastActivityAt = new Date(facts.lastActivityAt);
    return { internal, sharedVisitor, existingVisitor, revisit, alreadyConverted, unsubscribed: facts.unsubscribed,
        lastActivityAt: Number.isFinite(lastActivityAt.getTime()) ? lastActivityAt : target.session.startedAt };
}

export async function loadJourneyAudience(conn: Connection, target: {
    orgId: string; workspaceId: number; recordId: number; recipientEmail: string; sentAt: Date; session: SessionInput;
    fields: { key: string; label: string; fieldType: string; value: string }[];
}, now: Date, extraDomains: readonly string[] = []): Promise<JourneyAudience> {
    const emailKeys = target.fields.filter((f) => contactKindOf(f) === "email").map((f) => f.key);
    const keys = splitEmailKeys(emailKeys);
    const email = normalizeEmail(target.recipientEmail);
    const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
    // 'email' 칸만 records_workspace_email_norm_idx로 찾는다 — 정본과 같은 리터럴이라 공용 계획에서도 인덱스와 맞는다(T9).
    // own은 최대 한 행이고 없으면 스칼라가 NULL이므로 JOIN과 같은 결과를 내면서 own 주도 workspace 전체 스캔을 피한다.
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
            SELECT r.id, r.data FROM records r
            WHERE r.id = ANY(ARRAY(
                SELECT ${target.recordId}::int
                UNION ALL SELECT record_id FROM links
                UNION ALL SELECT record_id FROM identities
                UNION ALL SELECT rm.id FROM records rm
                    WHERE ${keys.indexed}::boolean AND rm.workspace_id = ${target.workspaceId}
                      AND left(lower(btrim(rm.data->>'email', chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203))), 200) = left(${email}, 200)
                      AND lower(btrim(rm.data->>'email', ${EMAIL_TRIM_CHARS})) = ${email}
                UNION ALL SELECT ro.id FROM records ro
                    WHERE cardinality(${keys.others}::text[]) > 0 AND ro.workspace_id = ${target.workspaceId}
                      AND EXISTS (SELECT 1 FROM unnest(${keys.others}::text[]) AS k(key)
                          WHERE lower(btrim(ro.data->>k.key, ${EMAIL_TRIM_CHARS})) = ${email})
            ))
              AND r.workspace_id = (SELECT workspace_id FROM own)
              AND r.org_id = (SELECT org_id FROM own)
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
                WHERE u.record_id IN (SELECT id FROM related) OR (u.workspace_id = own.workspace_id
                    AND lower(btrim(u.email, ${EMAIL_TRIM_CHARS})) = ${normalizeEmail(target.recipientEmail)})) AS unsubscribed,
            GREATEST(${target.session.startedAt.toISOString()}::timestamptz,
                (SELECT MAX(LEAST(COALESCE(v.ended_at, v.started_at), ${now.toISOString()})) FROM visits v),
                (SELECT MAX(e.occurred_at) FROM tracker_events e JOIN visits v ON v.id = e.session_id AND v.site_id = e.site_id
                    WHERE e.occurred_at <= ${now.toISOString()})) AS "lastActivityAt"
    `;
    if (!facts?.authorized) throw new Error("고객 여정 대상의 조직·사이트를 확인할 수 없습니다.");
    return summarizeJourneyAudience(facts, target, now, extraDomains);
}
