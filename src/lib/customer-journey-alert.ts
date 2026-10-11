import { queryClient } from "./db";
import { buildJourneyCard, summarizeJourney, type JourneyCardInput, type JourneyCardMessage } from "./customer-journey-card";
import { postGoogleChatMessage } from "./google-chat";
import { type EventInput } from "./deep-visitor-alert-rules";
import { journeyAlertConfig } from "./customer-journey-alert-config";

export { journeyAlertConfig } from "./customer-journey-alert-config";

type Env = Record<string, string | undefined>;
type Connection = Awaited<ReturnType<typeof queryClient.reserve>>;
const LOCK_KEY = 0x5c4edf10;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

interface CandidateRow {
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
async function loadCandidates(conn: Connection, workspaceId: number, now: Date, since: Date): Promise<CandidateRow[]> {
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
        JOIN records r ON r.id = l.record_id AND r.workspace_id = w.id
        JOIN partitions p ON p.id = r.partition_id AND p.workspace_id = w.id
        WHERE w.id = ${workspaceId}
          AND s.started_at >= ${since.toISOString()} AND s.started_at <= ${new Date(now.getTime() - 10 * 60 * 1000).toISOString()}
          AND c.clicked_at <= ${now.toISOString()}
          AND GREATEST(s.started_at, COALESCE(s.ended_at, s.started_at),
              COALESCE((SELECT MAX(e.occurred_at) FROM tracker_events e WHERE e.session_id = s.id AND e.occurred_at <= ${now.toISOString()}), s.started_at))
              <= ${new Date(now.getTime() - 10 * 60 * 1000).toISOString()}
          AND NOT EXISTS (SELECT 1 FROM customer_journey_alerts a WHERE a.session_id = s.id AND a.org_id = w.org_id)
        ORDER BY s.started_at, s.id
        LIMIT ${BATCH_SIZE}
    `;
}

function cardInput(row: CandidateRow, baseUrl: string): JourneyCardInput {
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

export interface JourneyAlertStats {
    mode: string; candidates: number; created: number; sent: number; failed: number; waitingForWebhook: boolean; skippedAsLocked?: boolean;
    waitingWorkspaceIds?: number[]; configurationError?: string;
}

/** 기존 깊이 알림과 별도 피드. 방문당 카드 한 장, 같은 고객의 재방문은 같은 챗 스레드에 모인다. */
export async function processCustomerJourneyAlerts(opts: { env?: Env; now?: Date; post?: typeof postGoogleChatMessage } = {}): Promise<JourneyAlertStats> {
    const env = opts.env ?? process.env;
    const config = journeyAlertConfig(env);
    const now = opts.now ?? new Date();
    const stats: JourneyAlertStats = { mode: config.mode, candidates: 0, created: 0, sent: 0, failed: 0, waitingForWebhook: false };
    if (config.mode === "off" || !config.ids.length) return stats;
    if (config.configurationError) return { ...stats, waitingForWebhook: true, waitingWorkspaceIds: config.ids, configurationError: config.configurationError };
    const conn = await queryClient.reserve();
    let acquired = false;
    try {
        const [lock] = await conn`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`;
        acquired = lock.ok === true;
        if (!acquired) return { ...stats, skippedAsLocked: true };
        await conn`UPDATE customer_journey_alerts SET status = 'skipped', last_error = '예약 후 24시간이 지나 보내지 않음'
            WHERE status = 'pending' AND created_at < ${new Date(now.getTime() - DAY_MS).toISOString()}`;
        const explicitStart = env.JOURNEY_ALERT_START_AT ? new Date(env.JOURNEY_ALERT_START_AT) : null;
        const since = new Date(Math.max(now.getTime() - 2 * DAY_MS, explicitStart && Number.isFinite(explicitStart.getTime()) ? explicitStart.getTime() : 0));
        for (const id of config.ids) {
            const rows = await loadCandidates(conn, id, now, since);
            stats.candidates += rows.length;
            for (const row of rows) {
                const input = cardInput(row, config.baseUrl);
                const summary = summarizeJourney(input, now);
                // 움직이는 중인 방문은 다음 회차에서 다시 판정한다. 기계 방문도 처리 기록을 남겨 다음 후보를 막지 않는다.
                if (summary.lastActivityAt.getTime() > now.getTime() - 10 * 60 * 1000) continue;
                const message = buildJourneyCard(input, now);
                const inserted = await conn`INSERT INTO customer_journey_alerts
                    (org_id, workspace_id, record_id, session_id, last_activity_at, stage, message, status, created_at, next_attempt_at)
                    VALUES (${row.org_id}, ${id}, ${row.record_id}, ${row.session_id}, ${summary.lastActivityAt.toISOString()}, ${summary.stage},
                        ${JSON.stringify(message)}::jsonb, ${!summary.eligible ? "skipped" : config.mode === "live" ? "pending" : "dry_run"}, ${now.toISOString()}, ${now.toISOString()})
                    ON CONFLICT (org_id, session_id) DO NOTHING RETURNING id`;
                stats.created += inserted.length;
            }
        }
        if (config.mode !== "live") return stats;
        stats.waitingForWebhook = config.missingIds.length > 0;
        if (config.missingIds.length) stats.waitingWorkspaceIds = config.missingIds;
        if (!config.readyIds.length) return stats;
        const pending = await conn<{ id: number; org_id: string; workspace_id: number; record_id: number; message: JourneyCardMessage | string; attempts: number }[]>`
            SELECT id, org_id, workspace_id, record_id, message, attempts FROM customer_journey_alerts
            WHERE status = 'pending' AND workspace_id = ANY(${config.readyIds}) AND next_attempt_at <= ${now.toISOString()}
            ORDER BY created_at, id LIMIT ${BATCH_SIZE}`;
        for (const alert of pending) {
            const message = typeof alert.message === "string" ? JSON.parse(alert.message) as JourneyCardMessage : alert.message;
            // 수신 웹훅은 requestId를 지원하지 않는다 (실제 API가 400으로 거절).
            const result = await (opts.post ?? postGoogleChatMessage)(config.routes[alert.workspace_id], message, fetch, {
                threadKey: `customer-journey-${alert.org_id}-${alert.workspace_id}-${alert.record_id}`,
            });
            if (result.ok) {
                await conn`UPDATE customer_journey_alerts SET status = 'sent', sent_at = ${now.toISOString()}, attempts = attempts + 1, last_error = NULL WHERE id = ${alert.id}`;
                stats.sent++;
            } else {
                const retry = result.retryable && !result.uncertain && alert.attempts < 4;
                await conn`UPDATE customer_journey_alerts SET status = ${result.uncertain ? "uncertain" : retry ? "pending" : "failed"}, attempts = attempts + 1,
                    last_error = ${result.error}, next_attempt_at = ${new Date(now.getTime() + 10 * 60 * 1000).toISOString()} WHERE id = ${alert.id}`;
                stats.failed++;
            }
        }
        return stats;
    } finally {
        if (acquired) await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
        conn.release();
    }
}
