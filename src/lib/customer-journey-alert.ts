import type { queryClient } from "./db";
import { buildJourneyCard, summarizeJourney, type JourneyCardInput, type JourneyCardMessage } from "./customer-journey-card";
import { postGoogleChatMessage } from "./google-chat";
import { type EventInput } from "./deep-visitor-alert-rules";
import { journeyAlertConfig } from "./customer-journey-alert-config";
import { loadJourneyAudience } from "./customer-journey-audience";
import { journeyOwner } from "./customer-journey-owner";
import type { JourneyCohortMember, JourneyPriority } from "./customer-journey-priority";

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
async function loadCandidates(conn: Connection, workspaceId: number, now: Date, since: Date, existing?: { sessionId: number; orgId: string }): Promise<CandidateRow[]> {
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

async function loadCohort(conn: Connection, workspaceId: number, now: Date): Promise<JourneyCohortMember[]> {
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

async function enrichedInput(conn: Connection, row: CandidateRow, baseUrl: string, now: Date, cohort: readonly JourneyCohortMember[], internalDomains: string[]) {
    const input = cardInput(row, baseUrl);
    input.cohort = cohort;
    input.audience = await loadJourneyAudience(conn, { orgId: row.org_id, workspaceId: row.workspace_id,
        recordId: row.record_id, recipientEmail: row.recipient_email, sentAt: input.sentAt, session: input.session, fields: input.fields }, now, internalDomains);
    return input;
}

type StoredJourneyMessage = JourneyCardMessage & { journeyPriority?: JourneyPriority & { ownerMentioned: boolean; ownerMentionedAt?: string | null } };

async function removeExcludedFromCohort(conn: Connection, row: CandidateRow, input: JourneyCardInput, priority: JourneyPriority) {
    if (!(input.audience?.internal || input.audience?.sharedVisitor || input.audience?.existingVisitor || input.audience?.unsubscribed || input.audience?.alreadyConverted)) return;
    // 뒤늦게 내부·공유·완료로 확인된 고객의 과거 점수도 순위 비교에서 제외한다. 원래 카드와 태그 이력은 보존한다.
    await conn`UPDATE customer_journey_alerts SET message = jsonb_set(message, '{journeyPriority,rankEligible}', 'false'::jsonb)
        WHERE org_id = ${row.org_id} AND workspace_id = ${row.workspace_id}
          AND message->'journeyPriority'->>'customerKey' = ${priority.customerKey}
          AND message->'journeyPriority'->>'rankEligible' = 'true'`;
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
export async function processCustomerJourneyAlerts(opts: { env?: Env; now?: Date; post?: typeof postGoogleChatMessage; client?: Pick<typeof queryClient, "reserve"> } = {}): Promise<JourneyAlertStats> {
    const env = opts.env ?? process.env;
    const config = journeyAlertConfig(env);
    const now = opts.now ?? new Date();
    const stats: JourneyAlertStats = { mode: config.mode, candidates: 0, created: 0, sent: 0, failed: 0, waitingForWebhook: false };
    if (config.mode === "off" || !config.ids.length) return stats;
    if (config.configurationError) return { ...stats, waitingForWebhook: true, waitingWorkspaceIds: config.ids, configurationError: config.configurationError };
    const internalDomains = (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(",").filter(Boolean);
    const client = opts.client ?? (await import("./db")).queryClient;
    const conn = await client.reserve();
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
            const cohort = await loadCohort(conn, id, now);
            const rows = await loadCandidates(conn, id, now, since);
            stats.candidates += rows.length;
            for (const row of rows) {
                const input = await enrichedInput(conn, row, config.baseUrl, now, cohort, internalDomains);
                const summary = summarizeJourney(input, now);
                await removeExcludedFromCohort(conn, row, input, summary.priority);
                if (!summary.priority.rankEligible) for (let i = cohort.length - 1; i >= 0; i--) {
                    if (cohort[i].customerKey === summary.priority.customerKey) cohort.splice(i, 1);
                }
                // 움직이는 중인 방문은 다음 회차에서 다시 판정한다. 기계 방문도 처리 기록을 남겨 다음 후보를 막지 않는다.
                if (summary.lastActivityAt.getTime() > now.getTime() - 10 * 60 * 1000) continue;
                const message: StoredJourneyMessage = { ...buildJourneyCard(input, now), journeyPriority: { ...summary.priority, ownerMentioned: false } };
                const inserted = await conn`INSERT INTO customer_journey_alerts
                    (org_id, workspace_id, record_id, session_id, last_activity_at, stage, message, status, created_at, next_attempt_at)
                    VALUES (${row.org_id}, ${id}, ${row.record_id}, ${row.session_id}, ${summary.lastActivityAt.toISOString()}, ${summary.stage},
                        ${JSON.stringify(message)}::jsonb, ${!summary.eligible ? "skipped" : config.mode === "live" ? "pending" : "dry_run"}, ${now.toISOString()}, ${now.toISOString()})
                    ON CONFLICT (org_id, session_id) DO NOTHING RETURNING id`;
                stats.created += inserted.length;
                if (inserted.length && summary.priority.rankEligible) cohort.push({ customerKey: summary.priority.customerKey, score: summary.priority.score });
            }
        }
        if (config.mode !== "live") return stats;
        stats.waitingForWebhook = config.missingIds.length > 0;
        if (config.missingIds.length) stats.waitingWorkspaceIds = config.missingIds;
        if (!config.readyIds.length) return stats;
        const pending = await conn<{ id: number; org_id: string; workspace_id: number; record_id: number; session_id: number; attempts: number }[]>`
            SELECT id, org_id, workspace_id, record_id, session_id, attempts FROM customer_journey_alerts
            WHERE status = 'pending' AND workspace_id = ANY(${config.readyIds}) AND next_attempt_at <= ${now.toISOString()}
            ORDER BY created_at, id LIMIT ${BATCH_SIZE}`;
        for (const alert of pending) {
            // 재시도 사이 신청 완료·재방문·내부 계정 연결이 생길 수 있으므로 현재 자료로 카드를 다시 만든다.
            const [row] = await loadCandidates(conn, alert.workspace_id, now, since, { sessionId: alert.session_id, orgId: alert.org_id });
            if (!row || row.record_id !== alert.record_id) {
                await conn`UPDATE customer_journey_alerts SET status = 'skipped', last_error = '전송 전 대상 연결 확인 실패' WHERE id = ${alert.id}`;
                continue;
            }
            const input = await enrichedInput(conn, row, config.baseUrl, now, await loadCohort(conn, alert.workspace_id, now), internalDomains);
            const summary = summarizeJourney(input, now);
            await removeExcludedFromCohort(conn, row, input, summary.priority);
            if (summary.lastActivityAt.getTime() > now.getTime() - 10 * 60 * 1000) {
                await conn`UPDATE customer_journey_alerts SET next_attempt_at = ${new Date(now.getTime() + 10 * 60 * 1000).toISOString()}, last_error = '추가 활동 확인: 이탈 판정 대기' WHERE id = ${alert.id}`;
                continue;
            }
            if (!summary.eligible) {
                await conn`UPDATE customer_journey_alerts SET status = 'skipped',
                    message = jsonb_set(message, '{journeyPriority,rankEligible}', 'false'::jsonb),
                    last_error = ${summary.priority.excludedReason} WHERE id = ${alert.id}`;
                continue;
            }
            const owner = summary.priority.tier === "urgent" ? journeyOwner(config.routes[alert.workspace_id]) : undefined;
            const [recent] = owner ? await conn`
                SELECT id FROM customer_journey_alerts WHERE org_id = ${alert.org_id} AND workspace_id = ${alert.workspace_id}
                    AND id <> ${alert.id} AND status IN ('sent', 'uncertain')
                    AND COALESCE((message->'journeyPriority'->>'ownerMentionedAt')::timestamptz, sent_at, created_at) > ${new Date(now.getTime() - DAY_MS).toISOString()}
                    AND message->'journeyPriority'->>'customerKey' = ${summary.priority.customerKey}
                    AND message->'journeyPriority'->>'ownerMentioned' = 'true' LIMIT 1` : [];
            const mentionUserId = owner && !recent ? owner.userId : undefined;
            const message: StoredJourneyMessage = { ...buildJourneyCard(input, now, owner ? { ownerName: owner.name, state: recent ? "cooldown" : "tag" } : undefined),
                journeyPriority: { ...summary.priority, ownerMentioned: Boolean(mentionUserId), ownerMentionedAt: mentionUserId ? now.toISOString() : null } };
            // 멘션은 요청 직전에 결과 미확인으로 기록한다. 응답 전 프로세스가 종료돼도 재태그하지 않는다.
            await conn`UPDATE customer_journey_alerts SET message = ${JSON.stringify(message)}::jsonb, stage = ${summary.stage},
                last_activity_at = ${summary.lastActivityAt.toISOString()}, status = ${mentionUserId ? "uncertain" : "pending"},
                last_error = ${mentionUserId ? "담당자 알림 전송 결과 미확인" : null} WHERE id = ${alert.id}`;
            // 수신 웹훅은 requestId를 지원하지 않는다 (실제 API가 400으로 거절).
            const result = await (opts.post ?? postGoogleChatMessage)(config.routes[alert.workspace_id], message, fetch, {
                threadKey: `customer-journey-${alert.org_id}-${alert.workspace_id}-${alert.record_id}`,
                mentionUserId,
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
