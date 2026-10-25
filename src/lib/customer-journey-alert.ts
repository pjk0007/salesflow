import type { queryClient } from "./db";
import { buildJourneyCard, summarizeJourney, type JourneyCardInput, type JourneyCardMessage } from "./customer-journey-card";
import { chatMessageIdFor, postGoogleChatMessage, type GoogleChatResult } from "./google-chat";
import { MARK_SENT_RETRY_MS, MARK_SENT_TRIES, retry } from "./deep-visitor-alert-delivery";
import { journeyAlertConfig } from "./customer-journey-alert-config";
import { journeyOwner } from "./customer-journey-owner";
import type { JourneyPriority } from "./customer-journey-priority";
import { loadCandidates, loadCohort, enrichedInput, type CandidateRow } from "./customer-journey-source";
import { ensureLeadFollowup, followupForCard, lastJourneyMention, processLeadReminders } from "./customer-journey-followup";

export { journeyAlertConfig } from "./customer-journey-alert-config";

type Env = Record<string, string | undefined>;
type Connection = Awaited<ReturnType<typeof queryClient.reserve>>;
const LOCK_KEY = 0x5c4edf10;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

type StoredJourneyMessage = JourneyCardMessage & { journeyPriority?: JourneyPriority & { ownerMentioned: boolean; ownerMentionedAt?: string | null } };

async function removeExcludedFromCohort(conn: Connection, row: CandidateRow, input: JourneyCardInput, priority: JourneyPriority) {
    if (!(input.audience?.internal || input.audience?.sharedVisitor || input.audience?.existingVisitor || input.audience?.unsubscribed || input.audience?.alreadyConverted)) return;
    // 뒤늦게 내부·공유·완료로 확인된 고객의 과거 점수도 순위 비교에서 제외한다. 원래 카드와 태그 이력은 보존한다.
    await conn`UPDATE customer_journey_alerts SET message = jsonb_set(message, '{journeyPriority,rankEligible}', 'false'::jsonb)
        WHERE org_id = ${row.org_id} AND workspace_id = ${row.workspace_id}
          AND message->'journeyPriority'->>'customerKey' = ${priority.customerKey}
          AND message->'journeyPriority'->>'rankEligible' = 'true'`;
}

/**
 * 여정 카드 한 장 보내기 (UX-224). 알림 줄·서버 주소로 만든 고정 messageId를 붙여, 구글에 올라갔는데 sent 기록을 못 남긴 카드를
 * 다음 회차에 다시 보내도 같은 ID의 409(이미 있음)로 끝나 채팅에 두 번 올라가지 않는다. sent 기록은 깊이 알림처럼 짧게 다시 해 본다.
 * 그래도 기록이 안 되면 던진다 — 줄은 pending(다음 회차에 같은 ID로 확인)이나 uncertain(멘션, 자동 재전송 안 함)으로 남는다.
 */
export async function deliverJourneyCard(args: {
    post: typeof postGoogleChatMessage;
    webhookUrl: string;
    message: { text: string; cardsV2?: unknown[] };
    env: Env;
    alert: { id: number; org_id: string; workspace_id: number; record_id: number };
    mentionUserId?: string;
    markSent: () => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
}): Promise<GoogleChatResult> {
    const { alert } = args;
    // 수신 웹훅은 requestId를 지원하지 않는다 (실제 API가 400으로 거절) — 고정 messageId를 쓴다.
    const result = await args.post(args.webhookUrl, args.message, fetch, {
        threadKey: `customer-journey-${alert.org_id}-${alert.workspace_id}-${alert.record_id}`,
        messageId: chatMessageIdFor(args.env, "journey", alert.id),
        mentionUserId: args.mentionUserId,
    });
    if (result.ok) {
        await retry(args.markSent, MARK_SENT_TRIES, MARK_SENT_RETRY_MS, args.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))));
    }
    return result;
}

export interface JourneyAlertStats {
    mode: string; candidates: number; created: number; sent: number; failed: number; waitingForWebhook: boolean; skippedAsLocked?: boolean;
    waitingWorkspaceIds?: number[]; configurationError?: string; reminded?: number; reminderFailed?: number;
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
                    (org_id, workspace_id, record_id, session_id, last_activity_at, stage, message, status, last_error, created_at, next_attempt_at)
                    VALUES (${row.org_id}, ${id}, ${row.record_id}, ${row.session_id}, ${summary.lastActivityAt.toISOString()}, ${summary.stage},
                        ${JSON.stringify(message)}::jsonb, ${!summary.eligible ? "skipped" : !summary.chatEligible ? "suppressed" : config.mode === "live" ? "pending" : "dry_run"},
                        ${summary.chatSuppressionReason}, ${now.toISOString()}, ${now.toISOString()})
                    ON CONFLICT (org_id, session_id) DO NOTHING RETURNING id`;
                stats.created += inserted.length;
                if (inserted.length && summary.priority.rankEligible) cohort.push({ customerKey: summary.priority.customerKey, score: summary.priority.score });
                if (inserted.length && summary.priority.rankEligible && summary.priority.tier !== "normal") await ensureLeadFollowup(conn,
                    { orgId: row.org_id, workspaceId: id, recordId: row.record_id, customerKey: summary.priority.customerKey,
                        urgent: summary.priority.tier === "urgent", assessedAt: now }, now);
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
            if (!summary.chatEligible) {
                // 알림만 억제하고 CRM 판정은 보존한다. 기존 대기 카드도 현재 측정값으로 확인한다.
                const message: StoredJourneyMessage = { ...buildJourneyCard(input, now), journeyPriority: { ...summary.priority, ownerMentioned: false } };
                await conn`UPDATE customer_journey_alerts SET status = 'suppressed', message = ${JSON.stringify(message)}::jsonb,
                    stage = ${summary.stage}, last_activity_at = ${summary.lastActivityAt.toISOString()},
                    last_error = ${summary.chatSuppressionReason} WHERE id = ${alert.id}`;
                continue;
            }
            const owner = summary.priority.tier === "urgent" ? journeyOwner(config.routes[alert.workspace_id]) : undefined;
            const followup = await followupForCard(conn, alert.org_id, alert.workspace_id, summary.priority.customerKey);
            const handled = followup && followup.status !== "new" && !(followup.status === "planned" && followup.dueAt && new Date(followup.dueAt) <= now);
            const lastMention = owner ? await lastJourneyMention(conn, alert.org_id, alert.workspace_id, summary.priority.customerKey) : null;
            const recent = lastMention && Date.parse(lastMention) > now.getTime() - DAY_MS;
            const mentionUserId = owner && !recent && !handled ? owner.userId : undefined;
            const message: StoredJourneyMessage = { ...buildJourneyCard(input, now, owner ? { ownerName: owner.name, state: handled ? "handled" : recent ? "cooldown" : "tag" } : undefined, followup),
                journeyPriority: { ...summary.priority, ownerMentioned: Boolean(mentionUserId), ownerMentionedAt: mentionUserId ? now.toISOString() : null } };
            // 멘션은 요청 직전에 결과 미확인으로 기록한다. 응답 전 프로세스가 종료돼도 재태그하지 않는다.
            await conn`UPDATE customer_journey_alerts SET message = ${JSON.stringify(message)}::jsonb, stage = ${summary.stage},
                last_activity_at = ${summary.lastActivityAt.toISOString()}, status = ${mentionUserId ? "uncertain" : "pending"},
                last_error = ${mentionUserId ? "담당자 알림 전송 결과 미확인" : null} WHERE id = ${alert.id}`;
            const result = await deliverJourneyCard({
                post: opts.post ?? postGoogleChatMessage,
                webhookUrl: config.routes[alert.workspace_id],
                message,
                env,
                alert,
                mentionUserId,
                markSent: async () => {
                    await conn`UPDATE customer_journey_alerts SET status = 'sent', sent_at = ${now.toISOString()}, attempts = attempts + 1, last_error = NULL WHERE id = ${alert.id}`;
                },
            });
            if (result.ok) {
                stats.sent++;
            } else {
                const retry = result.retryable && !result.uncertain && alert.attempts < 4;
                await conn`UPDATE customer_journey_alerts SET status = ${result.uncertain ? "uncertain" : retry ? "pending" : "failed"}, attempts = attempts + 1,
                    last_error = ${result.error}, next_attempt_at = ${new Date(now.getTime() + 10 * 60 * 1000).toISOString()} WHERE id = ${alert.id}`;
                stats.failed++;
            }
        }
        Object.assign(stats, await processLeadReminders(conn, { env, now, post: opts.post }));
        return stats;
    } finally {
        if (acquired) await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
        conn.release();
    }
}
