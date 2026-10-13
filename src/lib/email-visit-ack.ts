/** 7초 이상 실제 메일 유입 방문 → 일반 후속 중단 + 고객별 한 번 감사 메일 예약. */
import type { queryClient } from "./db";
import { EMAIL_TRIM_CHARS, normalizeEmail } from "./deep-visitor-alert-rules";
import { evaluateJourney } from "./customer-journey-card";
import { loadCandidates, enrichedInput } from "./customer-journey-source";
import { journeyCustomerKey } from "./customer-journey-priority";
import {
    measuredVisitSeconds,
    visitAckConfig,
    visitAckScheduledAt,
    VISIT_ACK_MIN_SECONDS,
} from "./email-visit-ack-rules";

export type VisitAckConnection = Awaited<
    ReturnType<typeof queryClient.reserve>
>;
type Env = Record<string, string | undefined>;
export interface VisitAckRow {
    id: number;
    org_id: string;
    workspace_id: number;
    customer_key: string;
    source_log_id: number;
    record_id: number;
    session_id: number;
    status: string;
    queue_id: number | null;
    send_log_id: number | null;
    scheduled_at: Date | string;
    observed_at: Date | string;
}
const CAPTURE_LOCK = 0x5c4edf17;

export async function stopVisitFollowups(
    conn: VisitAckConnection,
    orgId: string,
    workspaceId: number,
    email: string,
    now: Date,
) {
    const normalized = normalizeEmail(email);
    await conn`
        UPDATE email_followup_queue q SET status='cancelled', stop_reason='site_visit', processed_at=${now.toISOString()}, locked_at=NULL
        FROM email_send_logs l LEFT JOIN partitions p ON p.id=l.partition_id
             LEFT JOIN records r ON r.id=l.record_id AND r.org_id=l.org_id
        WHERE q.parent_log_id=l.id AND q.org_id=${orgId} AND l.org_id=q.org_id
          AND COALESCE(p.workspace_id,r.workspace_id)=${workspaceId}
          AND lower(btrim(l.recipient_email,${EMAIL_TRIM_CHARS}))=${normalized}
          AND q.source_type <> 'visit_ack' AND q.status IN ('pending','held','processing')`;
    await conn`
        UPDATE email_automation_queue q SET status='cancelled', stop_reason='site_visit', updated_at=${now.toISOString()}
        FROM email_template_links t, records r, partitions p
        WHERE q.template_link_id=t.id AND q.record_id=r.id AND q.org_id=${orgId}
          AND t.partition_id=p.id AND p.workspace_id=${workspaceId} AND r.org_id=q.org_id AND r.workspace_id=${workspaceId}
          AND lower(btrim(r.data->>t.recipient_field,${EMAIL_TRIM_CHARS}))=${normalized}
          AND q.kind='repeat' AND q.status IN ('pending','held')`;
}

/** 중단과 예약은 하나의 CTE로 확정한다. 감사 메일이 실패·취소돼도 기존 후속을 되살리지 않는다. */
export async function registerVisitAck(
    conn: VisitAckConnection,
    target: {
        orgId: string;
        workspaceId: number;
        email: string;
        sourceLogId: number;
        recordId: number;
        sessionId: number;
    },
    now: Date,
    scheduledAt: Date,
    cancelledReason: string | null = null,
) {
    const [ack] = await conn<VisitAckRow[]>`
        WITH saved AS (
            INSERT INTO email_visit_acknowledgements
                (org_id,workspace_id,customer_key,source_log_id,record_id,session_id,status,reason,scheduled_at,observed_at,created_at,updated_at)
            VALUES (${target.orgId},${target.workspaceId},${journeyCustomerKey(target.email)},${target.sourceLogId},${target.recordId},${target.sessionId},
                ${cancelledReason ? "cancelled" : "pending"},${cancelledReason},${scheduledAt.toISOString()},${now.toISOString()},${now.toISOString()},${now.toISOString()})
            ON CONFLICT (org_id,workspace_id,customer_key) DO UPDATE SET
                source_log_id=EXCLUDED.source_log_id,record_id=EXCLUDED.record_id,session_id=EXCLUDED.session_id,
                status=EXCLUDED.status,reason=EXCLUDED.reason,scheduled_at=EXCLUDED.scheduled_at,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at
            WHERE email_visit_acknowledgements.status='ignored'
            RETURNING *
        ), queued AS (
            INSERT INTO email_followup_queue (parent_log_id,source_type,source_id,org_id,step_index,check_at,status,stop_reason,created_at)
            SELECT source_log_id,'visit_ack',id,org_id,-1,scheduled_at,
                CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'pending' END,
                CASE WHEN status='cancelled' THEN reason ELSE NULL END,${now.toISOString()}
            FROM saved ON CONFLICT (parent_log_id,step_index) DO NOTHING RETURNING id,source_id
        ), cancelled AS (
            UPDATE email_followup_queue q SET status='cancelled',stop_reason='site_visit',processed_at=${now.toISOString()},locked_at=NULL
            FROM email_send_logs l LEFT JOIN partitions p ON p.id=l.partition_id LEFT JOIN records r ON r.id=l.record_id AND r.org_id=l.org_id
            WHERE EXISTS (SELECT 1 FROM saved) AND q.parent_log_id=l.id AND q.org_id=${target.orgId} AND l.org_id=q.org_id
              AND COALESCE(p.workspace_id,r.workspace_id)=${target.workspaceId}
              AND lower(btrim(l.recipient_email,${EMAIL_TRIM_CHARS}))=${normalizeEmail(target.email)}
              AND q.source_type <> 'visit_ack' AND q.status IN ('pending','held','processing')
        )
        SELECT saved.*,queued.id AS queue_id FROM saved LEFT JOIN queued ON queued.source_id=saved.id`;
    // 예약·후속 중단은 위 문장으로 함께 확정됐다. 표시용 queue_id만 뒤에서 연결한다.
    const [saved] = await conn<VisitAckRow[]>`
        UPDATE email_visit_acknowledgements a SET queue_id=q.id
        FROM email_followup_queue q WHERE a.org_id=${target.orgId} AND a.workspace_id=${target.workspaceId}
          AND a.customer_key=${journeyCustomerKey(target.email)} AND q.source_type='visit_ack' AND q.source_id=a.id AND q.org_id=a.org_id
        RETURNING a.*`;
    await stopVisitFollowups(
        conn,
        target.orgId,
        target.workspaceId,
        target.email,
        now,
    );
    return saved ?? ack;
}

export async function captureVisitAcknowledgements(
    conn: VisitAckConnection,
    options: {
        now: Date;
        env: Env;
        random?: () => number;
        orgId?: string;
        workspaceId?: number;
        email?: string;
    },
) {
    const { now, env } = options;
    const config = visitAckConfig(env);
    const stats = { captured: 0, ignored: 0, preview: 0 };
    if (config.mode === "off" || config.startAt > now) return stats;
    const since = new Date(
        Math.max(config.startAt.getTime(), now.getTime() - 48 * 3600_000),
    );
    const ids =
        options.workspaceId === undefined
            ? config.ids
            : config.ids.filter((id) => id === options.workspaceId);
    for (const workspaceId of ids) {
        const candidates = await conn<{ org_id: string; session_id: number }[]>`
            SELECT w.org_id,s.id AS session_id FROM workspaces w
            JOIN tracker_sites site ON site.workspace_id=w.id AND site.org_id=w.org_id AND site.is_active=1
            JOIN tracker_sessions s ON s.site_id=site.id
            JOIN email_click_logs c ON c.click_id=s.click_id AND c.org_id=w.org_id AND c.is_bot=false
            JOIN email_send_logs l ON l.id=c.send_log_id AND l.org_id=w.org_id AND l.status='sent' AND l.trigger_type IS DISTINCT FROM 'visit_ack'
            JOIN records r ON r.id=l.record_id AND r.workspace_id=w.id AND r.org_id=w.org_id
            JOIN partitions p ON p.id=r.partition_id AND p.workspace_id=w.id
            WHERE w.id=${workspaceId} AND s.started_at >= ${since.toISOString()} AND s.started_at <= ${now.toISOString()}
              AND c.clicked_at >= ${config.startAt.toISOString()} AND c.clicked_at <= ${now.toISOString()}
              AND (${options.orgId ?? null}::uuid IS NULL OR w.org_id=${options.orgId ?? null}::uuid)
              AND (${options.email ?? null}::text IS NULL OR lower(btrim(l.recipient_email,${EMAIL_TRIM_CHARS}))=${options.email ?? null})
              AND ((s.duration>=${VISIT_ACK_MIN_SECONDS} AND (s.ended_at IS NULL OR s.ended_at>=s.started_at+${VISIT_ACK_MIN_SECONDS}::int*interval '1 second'))
                  OR (s.duration IS NULL AND s.ended_at<=${now.toISOString()} AND s.ended_at>=s.started_at+${VISIT_ACK_MIN_SECONDS}::int*interval '1 second'))
              AND NOT EXISTS (SELECT 1 FROM email_visit_acknowledgements a WHERE a.org_id=w.org_id AND a.workspace_id=w.id
                  AND a.customer_key=encode(sha256(convert_to(lower(btrim(l.recipient_email,${EMAIL_TRIM_CHARS})),'UTF8')),'hex')
                  AND (a.status<>'ignored' OR (${options.email === undefined} AND a.next_check_at>${now.toISOString()})))
            ORDER BY s.id LIMIT 50`;
        for (const candidate of candidates) {
            const [source] = await loadCandidates(
                conn,
                workspaceId,
                now,
                since,
                { sessionId: candidate.session_id, orgId: candidate.org_id },
                {
                    startAt: config.startAt,
                    orgId: options.orgId,
                    email: options.email,
                },
            );
            if (!source) continue;
            const input = await enrichedInput(
                conn,
                source,
                env.NEXT_PUBLIC_BASE_URL ?? "https://sendb.kr",
                now,
                [],
                (env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
            );
            const { verdict } = evaluateJourney(input, now);
            const seconds = measuredVisitSeconds(input, now);
            const ignored =
                seconds === null ||
                seconds < VISIT_ACK_MIN_SECONDS ||
                verdict.machine ||
                input.audience?.internal ||
                input.audience?.sharedVisitor;
            if (config.mode === "dry_run") {
                if (!ignored) stats.preview++;
                continue;
            }
            if (ignored) {
                await conn`INSERT INTO email_visit_acknowledgements
                    (org_id,workspace_id,customer_key,source_log_id,record_id,session_id,status,reason,scheduled_at,observed_at,next_check_at)
                    VALUES (${source.org_id},${workspaceId},${journeyCustomerKey(source.recipient_email)},${source.send_log_id},${source.record_id},${source.session_id},
                        'ignored','내부·공유·자동 방문 또는 체류 미확인',${now.toISOString()},${now.toISOString()},${new Date(now.getTime() + 3600_000).toISOString()})
                    ON CONFLICT (org_id,workspace_id,customer_key) DO UPDATE SET next_check_at=EXCLUDED.next_check_at WHERE email_visit_acknowledgements.status='ignored'`;
                stats.ignored++;
                continue;
            }
            await registerVisitAck(
                conn,
                {
                    orgId: source.org_id,
                    workspaceId,
                    email: source.recipient_email,
                    sourceLogId: source.send_log_id,
                    recordId: source.record_id,
                    sessionId: source.session_id,
                },
                now,
                visitAckScheduledAt(now, options.random),
                input.audience?.unsubscribed
                    ? "unsubscribed"
                    : input.audience?.alreadyConverted
                      ? "completed"
                      : null,
            );
            stats.captured++;
        }
    }
    return stats;
}

/** 발송 경로가 AI 생성 전·HTTP 직전에 부른다. 스캔 회차 사이의 새 방문도 여기서 잡는다. */
export async function findVisitFollowupStop(
    orgId: string,
    workspaceId: number | null,
    email: string,
    now = new Date(),
    env: Env = process.env,
): Promise<boolean> {
    const config = visitAckConfig(env);
    if (
        config.mode !== "live" ||
        workspaceId === null ||
        !config.ids.includes(workspaceId) ||
        config.startAt > now
    )
        return false;
    const { queryClient: client } = await import("./db");
    const conn = await client.reserve();
    try {
        return await findVisitFollowupStopWithConnection(
            conn,
            orgId,
            workspaceId,
            email,
            now,
            env,
        );
    } finally {
        conn.release();
    }
}

export async function findVisitFollowupStopWithConnection(
    conn: VisitAckConnection,
    orgId: string,
    workspaceId: number,
    email: string,
    now: Date,
    env: Env,
) {
    const config = visitAckConfig(env);
    if (
        config.mode !== "live" ||
        !config.ids.includes(workspaceId) ||
        config.startAt > now
    )
        return false;
    const lookup = async () =>
        (
            await conn<
                { id: number }[]
            >`SELECT id FROM email_visit_acknowledgements WHERE org_id=${orgId} AND workspace_id=${workspaceId}
        AND customer_key=${journeyCustomerKey(email)} AND status<>'ignored' LIMIT 1`
        )[0];
    if (await lookup()) {
        await stopVisitFollowups(conn, orgId, workspaceId, email, now);
        return true;
    }
    await captureVisitAcknowledgements(conn, {
        now,
        env,
        orgId,
        workspaceId,
        email: normalizeEmail(email),
    });
    return Boolean(await lookup());
}

export async function processVisitAcknowledgements() {
    const config = visitAckConfig(process.env);
    if (config.mode === "off") return;
    const { queryClient: client } = await import("./db");
    const conn = await client.reserve();
    let acquired = false;
    try {
        acquired =
            (
                await conn<
                    { acquired: boolean }[]
                >`SELECT pg_try_advisory_lock(${CAPTURE_LOCK}) AS acquired`
            )[0]?.acquired === true;
        if (!acquired) return;
        await captureVisitAcknowledgements(conn, {
            now: new Date(),
            env: process.env,
        });
    } finally {
        if (acquired) await conn`SELECT pg_advisory_unlock(${CAPTURE_LOCK})`;
        conn.release();
    }
    if (config.mode === "live")
        await (
            await import("./email-followup")
        ).processEmailFollowupQueue({ visitOnly: true });
}
