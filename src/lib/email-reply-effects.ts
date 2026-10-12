/**
 * 회신 효과 (DESIGN-RPL 7절) — 사람 회신의 자동 메일 멈춤·레코드 사건·알림 줄, 반송의 SND 신호.
 *
 * - 멈춤은 같은 조직·같은 사업(워크스페이스)·같은 주소(회신 보낸 사람과 원래 받은 사람 둘 다, M3)의 pending·held 줄만 바꾼다.
 *   processing 줄은 건드리지 않는다 (워커가 쥐고 있다 — 보내기 직전 막기(email-reply-guard.ts)가 잡는다).
 *   멈춘 줄은 저절로 살아나지 않는다 (SEQ-1 수용 기준 2).
 * - dry_run은 같은 WHERE로 count만 한다 (planReplyEffects와 같은 주소 목록).
 * - 반송은 발송 기록을 직접 쓰지 않는다 — SND recordBounceSignal·applyPendingBounceSignals만 부른다 (7-3, B2).
 * - 효과 차지·멈춤·알림 줄은 부른 쪽이 연 트랜잭션 하나 안에서 한다 (m1).
 */
import { sql } from "drizzle-orm";
import type { DbExec } from "@/lib/db/tx";
import {
    EMAIL_TRIM_CHARS,
    buildReplyAlertMessage,
    buildUnmatchedReplyAlertMessage,
    contactFieldsOf,
    planReplyEffects,
    stepLabel,
    type ReplyEffectTarget,
    type RuleKind,
    type StopCounts,
} from "@/lib/email-reply-rules";
import { resolveFieldDefs, type FieldDefJson } from "@/lib/deep-visitor-alert-batch";
import {
    applyPendingBounceSignals,
    recordBounceSignal,
    type BounceSignalInput,
    type BounceSignalOutcome,
} from "@/lib/email-bounce-signal";

export interface HumanReplyEffectsInput extends ReplyEffectTarget {
    id: number;
    receivedAt: Date;
    sendLogId: number | null;
    ruleKind: string | null;
    ruleId: number | null;
    stepIndex: number | null;
}

export interface StopResult extends StopCounts {
    recordEventId: number | null;
}

const EMPTY_STOP: StopResult = { followups: 0, automation: 0, sendQueue: 0, recordEventId: null };

function rowsOf<T>(result: unknown): T[] {
    return result as T[];
}

/**
 * 7-2 사람 회신의 멈춤 (on) 또는 멈출 수 세기 (dry_run). 레코드 사건은 on일 때만, 레코드가 있을 때만.
 * 같은 회신으로 두 번 불러도 결과가 같다: 멈춤은 pending·held만 바꾸고, 사건은 meta.replyId가 있으면 넣지 않는다.
 */
export async function stopAutomationForReply(exec: DbExec, r: HumanReplyEffectsInput, opts: { dryRun: boolean }): Promise<StopResult> {
    const plan = planReplyEffects(r);
    if (!plan.stop || !r.orgId || r.workspaceId === null) return { ...EMPTY_STOP };
    const emails = sql.param(plan.emails);
    const stopMessage = `회신으로 멈춤 (회신 #${r.id})`;

    if (opts.dryRun) {
        const counted = rowsOf<{ followups: number; automation: number; send_queue: number }>(
            await exec.execute(sql`
                SELECT
                    (SELECT count(*)::int FROM email_followup_queue q
                       JOIN email_send_logs l ON l.id = q.parent_log_id
                       JOIN partitions p ON p.id = l.partition_id
                      WHERE q.status IN ('pending','held') AND q.org_id = ${r.orgId}::uuid AND l.org_id = ${r.orgId}::uuid
                        AND p.workspace_id = ${r.workspaceId}::int
                        AND lower(btrim(l.recipient_email, ${EMAIL_TRIM_CHARS}::text)) = ANY(${emails}::text[])) AS followups,
                    (SELECT count(*)::int FROM email_automation_queue
                      WHERE ${plan.recordId}::int IS NOT NULL AND record_id = ${plan.recordId}::int AND org_id = ${r.orgId}::uuid
                        AND kind IN ('first','first_bulk','repeat') AND status IN ('pending','held')) AS automation,
                    (SELECT count(*)::int FROM email_send_queue
                      WHERE ${plan.recordId}::int IS NOT NULL AND record_id = ${plan.recordId}::int AND org_id = ${r.orgId}::uuid
                        AND status IN ('pending','held')) AS send_queue
            `)
        )[0];
        return {
            followups: Number(counted?.followups ?? 0),
            automation: Number(counted?.automation ?? 0),
            sendQueue: Number(counted?.send_queue ?? 0),
            recordEventId: null,
        };
    }

    const followups = rowsOf<{ id: number }>(
        await exec.execute(sql`
            UPDATE email_followup_queue q
               SET status = 'cancelled', processed_at = now(), stop_reason = 'replied', locked_at = NULL
              FROM email_send_logs l JOIN partitions p ON p.id = l.partition_id
             WHERE q.status IN ('pending','held') AND q.org_id = ${r.orgId}::uuid
               AND l.id = q.parent_log_id AND l.org_id = ${r.orgId}::uuid
               AND p.workspace_id = ${r.workspaceId}::int
               AND lower(btrim(l.recipient_email, ${EMAIL_TRIM_CHARS}::text)) = ANY(${emails}::text[])
            RETURNING q.id
        `)
    );

    let automation: Array<{ id: number }> = [];
    let sendQueue: Array<{ id: number }> = [];
    let recordEventId: number | null = null;
    if (plan.recordId !== null) {
        automation = rowsOf<{ id: number }>(
            await exec.execute(sql`
                UPDATE email_automation_queue
                   SET status = 'cancelled', stop_reason = 'replied', updated_at = now()
                 WHERE record_id = ${plan.recordId}::int AND org_id = ${r.orgId}::uuid
                   AND kind IN ('first','first_bulk','repeat') AND status IN ('pending','held')
                RETURNING id
            `)
        );
        // 표에 없는 새 상태를 만들지 않는다 — 화면·통계가 모르는 값이 생기지 않게 skipped + 사유 글
        sendQueue = rowsOf<{ id: number }>(
            await exec.execute(sql`
                UPDATE email_send_queue
                   SET status = 'skipped', last_error = ${stopMessage}, processed_at = now(), locked_at = NULL
                 WHERE record_id = ${plan.recordId}::int AND org_id = ${r.orgId}::uuid AND status IN ('pending','held')
                RETURNING id
            `)
        );
    }
    if (plan.recordEvent && plan.recordId !== null) {
        const meta = JSON.stringify({ replyId: r.id, sendLogId: r.sendLogId, ruleKind: r.ruleKind, ruleId: r.ruleId, stepIndex: r.stepIndex });
        const ev = rowsOf<{ id: number }>(
            await exec.execute(sql`
                INSERT INTO record_events (org_id, record_id, type, label, occurred_at, meta)
                SELECT ${r.orgId}::uuid, ${plan.recordId}::int, 'reply', '회신', ${r.receivedAt.toISOString()}::timestamptz, ${meta}::jsonb
                WHERE EXISTS (SELECT 1 FROM records WHERE id = ${plan.recordId}::int)
                  AND NOT EXISTS (
                      SELECT 1 FROM record_events
                      WHERE record_id = ${plan.recordId}::int AND type = 'reply' AND meta->>'replyId' = ${String(r.id)}
                  )
                RETURNING id
            `)
        );
        recordEventId = ev[0]?.id ?? null;
    }
    return { followups: followups.length, automation: automation.length, sendQueue: sendQueue.length, recordEventId };
}

/**
 * 효과 차지 (7-1). 처음 적용(first)은 effects_applied_at이 비었을 때만, 분류를 사람으로 고친 뒤(reclassify, M5)는
 * effects_applied_kind가 human이 아닐 때만. 차지하지 못하면 false (이미 했다)
 */
export async function claimReplyEffects(exec: DbExec, replyId: number, kind: string, mode: "first" | "reclassify"): Promise<boolean> {
    const rows = rowsOf<{ id: number }>(
        mode === "first"
            ? await exec.execute(sql`
                  UPDATE email_replies SET effects_applied_at = now(), effects_applied_kind = ${kind}
                  WHERE id = ${replyId}::int AND effects_applied_at IS NULL
                  RETURNING id
              `)
            : await exec.execute(sql`
                  UPDATE email_replies SET effects_applied_at = now(), effects_applied_kind = ${kind}
                  WHERE id = ${replyId}::int AND effects_applied_kind IS DISTINCT FROM ${kind}
                  RETURNING id
              `)
    );
    return rows.length > 0;
}

// ============================================
// 반송 (7-3) — SND 함수만 부른다
// ============================================

export interface BounceEffectsResult {
    outcomes: BounceSignalOutcome[];
    /** 이번에 남긴 레코드 사건 'email_bounce' 수 */
    recordEvents: number;
}

/**
 * hard·받는 사람 같음·이번에 처음 적용된 신호마다 레코드 사건 'email_bounce' (레코드가 있을 때만).
 * 우리 발신 쪽 실패(5.7.x·인증·정책)는 받는 사람의 반송이 아니라 남기지 않는다 (F2, PRD SND-2)
 */
async function insertBounceEvents(exec: DbExec, outcomes: readonly BounceSignalOutcome[], orgIds: readonly string[], receivedAt: Date | null): Promise<number> {
    let n = 0;
    for (const o of outcomes) {
        if (o.duplicate || o.outOfScope || !o.applied || o.kind !== "hard" || o.recipientMatch !== "same" || o.recordId === null) continue;
        if (o.blockClass === "sender") continue;
        const meta = JSON.stringify({ signalId: o.signalId, sendLogId: o.sendLogId });
        const rows = rowsOf<{ id: number }>(
            await exec.execute(sql`
                INSERT INTO record_events (org_id, record_id, type, label, occurred_at, meta)
                SELECT r.org_id, r.id, 'email_bounce', '반송', COALESCE(${receivedAt ? receivedAt.toISOString() : null}::timestamptz, now()), ${meta}::jsonb
                FROM records r
                WHERE r.id = ${o.recordId}::int AND r.org_id = ANY(${sql.param([...orgIds])}::uuid[])
                  AND NOT EXISTS (
                      SELECT 1 FROM record_events e
                      WHERE e.record_id = r.id AND e.type = 'email_bounce' AND e.meta->>'signalId' = ${String(o.signalId)}
                  )
                RETURNING id
            `)
        );
        n += rows.length;
    }
    return n;
}

/** 반송 안내 한 통 → SND 신호 (on이면 apply) + 레코드 사건 */
export async function recordBounceForReply(exec: DbExec, input: BounceSignalInput): Promise<BounceEffectsResult> {
    const outcomes = await recordBounceSignal(input, exec);
    const recordEvents = input.apply ? await insertBounceEvents(exec, outcomes, input.orgIds, input.receivedAt) : 0;
    return { outcomes, recordEvents };
}

/** on으로 바뀐 뒤 dry_run 때 남긴 신호를 적용 (밀린 효과, 7-1) */
export async function applyPendingBouncesForReplies(exec: DbExec, orgIds: string[], since: Date): Promise<BounceEffectsResult> {
    const outcomes = await applyPendingBounceSignals(orgIds, since, exec);
    const recordEvents = await insertBounceEvents(exec, outcomes, orgIds, null);
    return { outcomes, recordEvents };
}

// ============================================
// 카드 (8절) — 재료 읽기 + 글자
// ============================================

export interface CardReply {
    id: number;
    orgId: string | null;
    workspaceId: number | null;
    recordId: number | null;
    sendLogId: number | null;
    rootLogId: number | null;
    ruleKind: string | null;
    ruleId: number | null;
    stepIndex: number | null;
    fromName: string | null;
    fromEmail: string;
    toEmail: string;
    subject: string | null;
    excerpt: string | null;
    receivedAt: Date;
    unsubscribeHint: boolean;
}

interface CardContextRow {
    workspace_name: string | null;
    default_field_type_id: number | null;
    record_data: Record<string, unknown> | null;
    integrated_code: string | null;
    partition_name: string | null;
    partition_field_type_id: number | null;
    rule_name: string | null;
    root_sent_at: string | Date | null;
    sent_at: string | Date | null;
    fields: FieldDefJson[] | null;
}

function toDate(v: string | Date | null): Date | null {
    if (v === null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** 카드 재료 한 문장: 사업 이름·레코드 칸·칸 정의·규칙 이름·첫 메일/이어진 발송 시각 */
async function loadCardContext(exec: DbExec, r: CardReply): Promise<CardContextRow | null> {
    if (r.workspaceId === null || !r.orgId) return null;
    const rows = rowsOf<CardContextRow>(
        await exec.execute(sql`
            WITH ws AS (SELECT id, name, default_field_type_id FROM workspaces WHERE id = ${r.workspaceId}::int AND org_id = ${r.orgId}::uuid),
            rec AS (
                SELECT rc.data, rc.integrated_code, p.name AS partition_name, p.field_type_id AS partition_field_type_id
                FROM records rc JOIN partitions p ON p.id = rc.partition_id
                WHERE rc.id = ${r.recordId}::int AND rc.org_id = ${r.orgId}::uuid
            )
            SELECT ws.name AS workspace_name, ws.default_field_type_id,
                   (SELECT data FROM rec) AS record_data,
                   (SELECT integrated_code FROM rec) AS integrated_code,
                   (SELECT partition_name FROM rec) AS partition_name,
                   (SELECT partition_field_type_id FROM rec) AS partition_field_type_id,
                   CASE ${r.ruleKind}::text
                       WHEN 'ai' THEN (SELECT name FROM email_auto_personalized_links WHERE id = ${r.ruleId}::int AND org_id = ${r.orgId}::uuid)
                       WHEN 'template' THEN (SELECT t.name FROM email_template_links t
                                               JOIN partitions tp ON tp.id = t.partition_id
                                               JOIN workspaces tw ON tw.id = tp.workspace_id
                                              WHERE t.id = ${r.ruleId}::int AND tw.org_id = ${r.orgId}::uuid)
                   END AS rule_name,
                   (SELECT sent_at FROM email_send_logs WHERE id = ${r.rootLogId}::int AND org_id = ${r.orgId}::uuid) AS root_sent_at,
                   (SELECT sent_at FROM email_send_logs WHERE id = ${r.sendLogId}::int AND org_id = ${r.orgId}::uuid) AS sent_at,
                   (SELECT COALESCE(json_agg(json_build_object(
                        'key', fd.key, 'label', fd.label, 'field_type', fd.field_type,
                        'field_type_id', fd.field_type_id, 'workspace_id', fd.workspace_id
                    ) ORDER BY fd.sort_order, fd.id), '[]'::json)
                    FROM field_definitions fd
                    WHERE fd.field_type_id = COALESCE((SELECT partition_field_type_id FROM rec), ws.default_field_type_id)
                       OR (COALESCE((SELECT partition_field_type_id FROM rec), ws.default_field_type_id) IS NULL AND fd.workspace_id = ws.id)
                   ) AS fields
            FROM ws
        `)
    );
    return rows[0] ?? null;
}

/**
 * 카드 글자 (8절). 이어진 회신은 레코드 연락 요약·규칙·단계, 사업 추정 회신은 못 이은 회신 카드.
 * 재료를 못 읽으면(워크스페이스가 사라짐) null — 알림 줄을 만들지 않는다
 */
export async function buildAlertMessageFor(
    exec: DbExec,
    r: CardReply,
    target: "matched" | "unmatched",
    opts: { now: Date; baseUrl: string; stopped: StopCounts | null; preview: boolean }
): Promise<string | null> {
    const ctx = await loadCardContext(exec, r);
    if (!ctx) return null;
    const workspaceName = ctx.workspace_name ?? `워크스페이스 ${r.workspaceId}`;
    if (target === "unmatched") {
        return buildUnmatchedReplyAlertMessage({
            now: opts.now,
            receivedAt: r.receivedAt,
            replyId: r.id,
            baseUrl: opts.baseUrl,
            workspaceName,
            fromName: r.fromName,
            fromEmail: r.fromEmail,
            toEmail: r.toEmail,
            subject: r.subject,
            excerpt: r.excerpt,
        });
    }
    const defs =
        r.workspaceId !== null
            ? resolveFieldDefs(
                  { id: r.workspaceId, defaultFieldTypeId: ctx.default_field_type_id },
                  { fieldTypeId: ctx.partition_field_type_id },
                  ctx.fields ?? [],
                  new Map()
              )
            : [];
    return buildReplyAlertMessage({
        now: opts.now,
        receivedAt: r.receivedAt,
        replyId: r.id,
        baseUrl: opts.baseUrl,
        workspaceName,
        contactFields: contactFieldsOf(defs, ctx.record_data),
        fromName: r.fromName,
        fromEmail: r.fromEmail,
        ruleKind: (r.ruleKind as RuleKind | null) ?? null,
        ruleName: ctx.rule_name,
        stepText: stepLabel(r.stepIndex, toDate(ctx.root_sent_at), toDate(ctx.sent_at)),
        recordId: r.recordId,
        integratedCode: ctx.integrated_code,
        partitionName: ctx.partition_name,
        excerpt: r.excerpt,
        stopped: opts.stopped,
        preview: opts.preview,
        unsubscribeHint: r.unsubscribeHint,
    });
}
