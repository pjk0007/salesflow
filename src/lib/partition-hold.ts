/**
 * 명단 보류·발신 주소 자동 멈춤 — DB (docs/2026-10-11-reply-and-health/DESIGN-SND.md 6-2·6-3·6-5).
 *
 * - getActiveHold: 발송 경로가 보내기 전에 본다 (대량만 — purpose 'inbound'면 늘 null). AI 호출·발신 자리 잡기보다 먼저.
 *   표가 없으면(0075 전) 막지 않는다 — 마이그레이션이 미뤄져도 발송이 멈추지 않게
 * - holdPartition: 보류 1줄 + 세 대기열의 대량 pending 줄 → held (last_error·순서는 그대로, SND-14)
 * - releasePartitionHold: 관리자 풀기. held → pending (원래 순서), 풀린 시각이 재판정 하한이 된다 (5-2)
 * - reviveOrphanHeldRows: 걸린 보류가 없는데 held로 남은 줄을 되살린다 (처리 중에 풀린 줄 — F6). 워커가 회차 첫머리에 부른다
 * - pauseSenderForHealth: 자동 멈춤 (손으로 멈춘 주소·알림만 주소·조직 기본 주소는 바꾸지 않는다)
 * - releaseSenderPause: 자동 멈춤 풀기 — 풀기 API와 설정 화면 PUT이 같은 함수를 쓴다. 웜업 시작일을 멈춘 날만큼 뒤로 (SND-10)
 * 모든 조회·갱신에 조직 조건을 단다 (PRD 6절). 알림·사건은 부른 쪽이 sender-health.ts의 notifyRelease로 남긴다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { kstParts } from "@/lib/kst";
import { capForDate, shiftWarmupStart, toLimitSettings, warmupDayIndex } from "@/lib/email-sender-limit-rules";
import type { SendPurpose } from "@/lib/email-sender-limit-rules";
import { describeReplyError, pgErrorOf } from "@/lib/email-reply-rules";
import { QUEUE_WAIT_PREFIX } from "@/lib/auto-personalized-email-outcome";

export interface ActiveHold {
    id: number;
    partitionId: number;
    workspaceId: number;
    scope: string;
    reasonText: string;
    heldAt: Date;
}

let warnedMissing = false;

function isMissingRelation(e: unknown): boolean {
    const code = pgErrorOf(e)?.code;
    return code === "42P01" || code === "42703";
}

function warnMissingOnce(e: unknown): void {
    if (warnedMissing) return;
    warnedMissing = true;
    console.warn(`[partition-hold] 명단 보류 표가 없어 보지 않음 (마이그레이션 0075 확인 필요): ${describeReplyError(e)}`);
}

function toDate(v: unknown): Date {
    return v instanceof Date ? v : new Date(String(v));
}

/**
 * 이 명단의 풀리지 않은 보류 (대량 발송만 막는다 — DESIGN-SND 6-2, SND-09).
 * purpose 'inbound'(폼·광고·단건 문의, 대기열 priority 1, 템플릿 'first', 수동 1건)면 늘 null — 문의는 바로 보낸다.
 */
export async function getActiveHold(
    orgId: string,
    partitionId: number | null | undefined,
    purpose: SendPurpose,
    exec: DbExec = db
): Promise<ActiveHold | null> {
    if (purpose === "inbound" || partitionId === null || partitionId === undefined) return null;
    try {
        const rows = (await exec.execute(sql`
            SELECT id, partition_id, workspace_id, scope, reason_text, held_at
            FROM email_partition_holds
            WHERE partition_id = ${partitionId}::int AND org_id = ${orgId}::uuid AND released_at IS NULL
            LIMIT 1
        `)) as unknown as Array<{ id: number; partition_id: number; workspace_id: number; scope: string; reason_text: string; held_at: unknown }>;
        const r = rows[0];
        if (!r) return null;
        return {
            id: Number(r.id),
            partitionId: Number(r.partition_id),
            workspaceId: Number(r.workspace_id),
            scope: r.scope,
            reasonText: r.reason_text,
            heldAt: toDate(r.held_at),
        };
    } catch (e) {
        if (isMissingRelation(e)) {
            warnMissingOnce(e);
            return null;
        }
        throw e;
    }
}

/** 여러 명단의 풀리지 않은 보류 (수동 발송·화면). 명단 이름을 함께 준다 */
export async function getActiveHoldsFor(
    orgId: string,
    partitionIds: readonly number[]
): Promise<Map<number, ActiveHold & { partitionName: string }>> {
    const out = new Map<number, ActiveHold & { partitionName: string }>();
    const ids = [...new Set(partitionIds.filter((n) => Number.isInteger(n)))];
    if (ids.length === 0) return out;
    try {
        const rows = (await db.execute(sql`
            SELECT h.id, h.partition_id, h.workspace_id, h.scope, h.reason_text, h.held_at, p.name AS partition_name
            FROM email_partition_holds h
            JOIN partitions p ON p.id = h.partition_id
            WHERE h.org_id = ${orgId}::uuid AND h.released_at IS NULL
              AND h.partition_id = ANY(${sql.param(ids)}::int[])
        `)) as unknown as Array<{
            id: number;
            partition_id: number;
            workspace_id: number;
            scope: string;
            reason_text: string;
            held_at: unknown;
            partition_name: string;
        }>;
        for (const r of rows) {
            out.set(Number(r.partition_id), {
                id: Number(r.id),
                partitionId: Number(r.partition_id),
                workspaceId: Number(r.workspace_id),
                scope: r.scope,
                reasonText: r.reason_text,
                heldAt: toDate(r.held_at),
                partitionName: r.partition_name,
            });
        }
    } catch (e) {
        if (isMissingRelation(e)) {
            warnMissingOnce(e);
            return out;
        }
        throw e;
    }
    return out;
}

export interface HoldQueueCounts {
    sendQueue: number;
    followup: number;
    automation: number;
}

/**
 * 명단 보류를 건다 (한 트랜잭션). 새로 걸렸을 때만 세 대기열의 대량 pending 줄을 held로 바꾼다:
 *   AI 대기열 priority 0 · 후속 전부(원본 기록의 명단) · 템플릿 'repeat'·'first_bulk' (문의 첫 메일 'first'는 빼고)
 * last_error·순서(scheduled_at·check_at·next_run_at)는 그대로 둔다 (SND-14). 처리 중(processing) 줄은 경로별 확인에서 걸린다.
 */
export async function holdPartition(input: {
    orgId: string;
    workspaceId: number;
    partitionId: number;
    reasonText: string;
    metrics?: Record<string, unknown>;
    eventId?: number | null;
}): Promise<{ holdId: number | null; isNew: boolean; queued: HoldQueueCounts }> {
    return db.transaction(async (tx) => {
        const inserted = (await tx.execute(sql`
            INSERT INTO email_partition_holds (org_id, workspace_id, partition_id, scope, source, reason_code, reason_text, metrics, event_id)
            VALUES (${input.orgId}::uuid, ${input.workspaceId}::int, ${input.partitionId}::int, 'bulk', 'auto', 'fail_rate',
                    ${input.reasonText}, ${JSON.stringify(input.metrics ?? {})}::jsonb, ${input.eventId ?? null})
            ON CONFLICT (partition_id) WHERE released_at IS NULL DO NOTHING
            RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (inserted.length === 0) {
            const existing = (await tx.execute(sql`
                SELECT id FROM email_partition_holds
                WHERE partition_id = ${input.partitionId}::int AND org_id = ${input.orgId}::uuid AND released_at IS NULL
            `)) as unknown as Array<{ id: number }>;
            return { holdId: existing[0]?.id ?? null, isNew: false, queued: { sendQueue: 0, followup: 0, automation: 0 } };
        }
        const queued = await setQueuesHeld(tx, input.orgId, input.partitionId);
        return { holdId: Number(inserted[0].id), isNew: true, queued };
    });
}

async function setQueuesHeld(tx: DbExec, orgId: string, partitionId: number): Promise<HoldQueueCounts> {
    const sendQueue = (await tx.execute(sql`
        UPDATE email_send_queue SET status = 'held', locked_at = NULL, requeue_at = NULL
        WHERE partition_id = ${partitionId}::int AND org_id = ${orgId}::uuid AND status = 'pending' AND priority = 0
        RETURNING id
    `)) as unknown as unknown[];
    const followup = (await tx.execute(sql`
        UPDATE email_followup_queue q SET status = 'held', locked_at = NULL
        FROM email_send_logs l
        WHERE q.parent_log_id = l.id AND l.partition_id = ${partitionId}::int AND l.org_id = ${orgId}::uuid
          AND q.org_id = ${orgId}::uuid AND q.status = 'pending'
        RETURNING q.id
    `)) as unknown as unknown[];
    const automation = (await tx.execute(sql`
        UPDATE email_automation_queue q SET status = 'held', updated_at = now()
        FROM email_template_links t
        WHERE q.template_link_id = t.id AND t.partition_id = ${partitionId}::int AND q.org_id = ${orgId}::uuid
          AND q.status = 'pending' AND q.kind IN ('repeat', 'first_bulk')
        RETURNING q.id
    `)) as unknown as unknown[];
    return { sendQueue: sendQueue.length, followup: followup.length, automation: automation.length };
}

/** 이 명단의 held 줄 수 (화면·알림 글 "대기 N통") */
export async function countHeldQueue(orgId: string, partitionId: number): Promise<HoldQueueCounts> {
    const rows = (await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM email_send_queue WHERE partition_id = ${partitionId}::int AND org_id = ${orgId}::uuid AND status = 'held') AS send_queue,
          (SELECT count(*)::int FROM email_followup_queue q JOIN email_send_logs l ON l.id = q.parent_log_id
            WHERE l.partition_id = ${partitionId}::int AND q.org_id = ${orgId}::uuid AND q.status = 'held') AS followup,
          (SELECT count(*)::int FROM email_automation_queue q JOIN email_template_links t ON t.id = q.template_link_id
            WHERE t.partition_id = ${partitionId}::int AND q.org_id = ${orgId}::uuid AND q.status = 'held') AS automation
    `)) as unknown as Array<{ send_queue: number; followup: number; automation: number }>;
    const r = rows[0];
    return { sendQueue: Number(r?.send_queue ?? 0), followup: Number(r?.followup ?? 0), automation: Number(r?.automation ?? 0) };
}

/**
 * 명단 보류 풀기 (관리자, 한 트랜잭션). 풀리지 않은 이 조직의 보류만. held → pending:
 *   AI 대기열: last_error는 그대로 (SND-14), 후속: check_at = GREATEST(check_at, now), 템플릿: next_run_at = GREATEST(next_run_at, now)
 * 풀린 시각(released_at)이 재판정 하한이다 — 그 뒤 발송만으로 다시 판정한다 (5-2, SND-05). 부른 쪽이 wakeSendQueue·알림을 한다.
 */
export async function releasePartitionHold(
    orgId: string,
    holdId: number,
    userId: string,
    note: string | null
): Promise<{ partitionId: number; workspaceId: number; releasedAt: Date; revived: HoldQueueCounts } | null> {
    return db.transaction(async (tx) => {
        const rows = (await tx.execute(sql`
            UPDATE email_partition_holds SET released_at = now(), released_by = ${userId}::uuid, release_note = ${note}
            WHERE id = ${holdId}::int AND org_id = ${orgId}::uuid AND released_at IS NULL
            RETURNING partition_id, workspace_id, released_at
        `)) as unknown as Array<{ partition_id: number; workspace_id: number; released_at: unknown }>;
        const r = rows[0];
        if (!r) return null;
        const p = Number(r.partition_id);
        const sendQueue = (await tx.execute(sql`
            UPDATE email_send_queue SET status = 'pending', locked_at = NULL
            WHERE partition_id = ${p}::int AND org_id = ${orgId}::uuid AND status = 'held'
            RETURNING id
        `)) as unknown as unknown[];
        const followup = (await tx.execute(sql`
            UPDATE email_followup_queue q SET status = 'pending', locked_at = NULL, check_at = GREATEST(q.check_at, now())
            FROM email_send_logs l
            WHERE q.parent_log_id = l.id AND l.partition_id = ${p}::int AND l.org_id = ${orgId}::uuid
              AND q.org_id = ${orgId}::uuid AND q.status = 'held'
            RETURNING q.id
        `)) as unknown as unknown[];
        const automation = (await tx.execute(sql`
            UPDATE email_automation_queue q SET status = 'pending', next_run_at = GREATEST(q.next_run_at, now()), updated_at = now()
            FROM email_template_links t
            WHERE q.template_link_id = t.id AND t.partition_id = ${p}::int AND q.org_id = ${orgId}::uuid AND q.status = 'held'
            RETURNING q.id
        `)) as unknown as unknown[];
        return {
            partitionId: p,
            workspaceId: Number(r.workspace_id),
            releasedAt: toDate(r.released_at),
            revived: { sendQueue: sendQueue.length, followup: followup.length, automation: automation.length },
        };
    });
}

export type HeldQueueTable = "send_queue" | "followup" | "automation";

/**
 * 걸린 보류가 없는 명단의 held 줄 → pending (F6). 워커는 보류를 확인한 뒤 묶음이 끝날 때 상태를 쓰므로, 그 사이 관리자가 보류를 풀면
 * (풀기는 held 줄만 되살린다 — 그때 processing이던 줄은 못 본다) 주인 없는 held 줄이 남아 영영 나가지 않는다.
 * 각 워커가 자기 대기열을 회차 첫머리에 한 번 정리한다. 되살리는 모양은 releasePartitionHold와 같다 (순서·미룸 사유 그대로).
 * 표가 없으면(0075 전) 아무것도 하지 않는다
 *
 * AI 대기열은 같은 held를 쓰는 두 보류도 여기서 되살린다 (UX-228·259, last_error 앞머리 QUEUE_WAIT_PREFIX):
 *   규칙 꺼짐  그 파티션·트리거에 켜진 규칙이 생겼거나 규칙이 모두 지워졌을 때 (지워졌으면 워커가 '규칙 없음'으로 닫는다)
 *   AI 한도    quotaOpen(조직)이 true일 때 — 부르는 쪽이 넘긴다. 안 넘기면 되살리지 않는다
 * 명단 보류는 대량 줄(priority 0)만 막으므로 보류 중인 명단의 문의 줄은 위 조건만 본다. scope를 주면 그 조직·파티션만 본다(규칙 켜기 직후)
 */
export async function reviveOrphanHeldRows(
    table: HeldQueueTable,
    opts: { quotaOpen?: (orgId: string) => Promise<boolean>; scope?: { orgId: string; partitionId: number } } = {}
): Promise<number> {
    try {
        let rows: unknown[];
        if (table === "send_queue") {
            const rulesPrefix = `${QUEUE_WAIT_PREFIX.rules_inactive}%`;
            const quotaPrefix = `${QUEUE_WAIT_PREFIX.quota_exceeded}%`;
            const scope = opts.scope
                ? sql`AND q.org_id = ${opts.scope.orgId}::uuid AND q.partition_id = ${opts.scope.partitionId}::int`
                : sql``;
            const quotaOrgs: string[] = [];
            if (opts.quotaOpen) {
                const held = (await db.execute(sql`
                    SELECT DISTINCT q.org_id FROM email_send_queue q
                    WHERE q.status = 'held' AND q.last_error LIKE ${quotaPrefix} ${scope}
                `)) as unknown as Array<{ org_id: string }>;
                for (const r of held) if (await opts.quotaOpen(String(r.org_id))) quotaOrgs.push(String(r.org_id));
            }
            rows = (await db.execute(sql`
                UPDATE email_send_queue q SET status = 'pending', locked_at = NULL
                WHERE q.status = 'held' ${scope}
                  AND (q.priority <> 0 OR NOT EXISTS (
                      SELECT 1 FROM email_partition_holds h
                      WHERE h.partition_id = q.partition_id AND h.org_id = q.org_id AND h.released_at IS NULL
                  ))
                  AND (
                      q.last_error IS NULL OR q.last_error NOT LIKE 'held(%'
                      OR (q.last_error LIKE ${rulesPrefix} AND (
                          EXISTS (
                              SELECT 1 FROM email_auto_personalized_links a
                              WHERE a.partition_id = q.partition_id AND a.is_active = 1
                                AND a.trigger_type = CASE WHEN q.trigger_type = 'on_update' THEN 'on_update' ELSE 'on_create' END
                          )
                          OR NOT EXISTS (
                              SELECT 1 FROM email_auto_personalized_links a
                              WHERE a.partition_id = q.partition_id
                                AND a.trigger_type = CASE WHEN q.trigger_type = 'on_update' THEN 'on_update' ELSE 'on_create' END
                          )
                      ))
                      OR (q.last_error LIKE ${quotaPrefix} AND q.org_id = ANY(${sql.param(quotaOrgs)}::uuid[]))
                  )
                RETURNING q.id
            `)) as unknown as unknown[];
        } else if (table === "followup") {
            rows = (await db.execute(sql`
                UPDATE email_followup_queue q SET status = 'pending', locked_at = NULL, check_at = GREATEST(q.check_at, now())
                WHERE q.status = 'held'
                  AND NOT EXISTS (
                      SELECT 1 FROM email_send_logs l
                      JOIN email_partition_holds h ON h.partition_id = l.partition_id AND h.org_id = l.org_id AND h.released_at IS NULL
                      WHERE l.id = q.parent_log_id AND l.org_id = q.org_id
                  )
                RETURNING q.id
            `)) as unknown as unknown[];
        } else {
            rows = (await db.execute(sql`
                UPDATE email_automation_queue q SET status = 'pending', next_run_at = GREATEST(q.next_run_at, now()), updated_at = now()
                WHERE q.status = 'held'
                  AND NOT EXISTS (
                      SELECT 1 FROM email_template_links t
                      JOIN email_partition_holds h ON h.partition_id = t.partition_id AND h.org_id = q.org_id AND h.released_at IS NULL
                      WHERE t.id = q.template_link_id
                  )
                RETURNING q.id
            `)) as unknown as unknown[];
        }
        if (rows.length > 0) console.log(`[partition-hold] 보류 없이 held로 남은 ${table} 줄 ${rows.length}개를 되살림`);
        return rows.length;
    } catch (e) {
        if (isMissingRelation(e)) {
            warnMissingOnce(e);
            return 0;
        }
        throw e;
    }
}

/**
 * 발신 건강 자동 멈춤 (6-3). 이미 멈춘 주소(손이든 자동이든)·health_action='alert'·조직 기본 주소는 바꾸지 않는다 → false.
 * 멈춘 뒤 동작은 원래 정지와 같다 (모든 발송 경로가 is_paused를 따른다).
 */
export async function pauseSenderForHealth(orgId: string, profileId: number, reason: string): Promise<boolean> {
    const rows = (await db.execute(sql`
        UPDATE email_sender_profiles
           SET is_paused = true, paused_source = 'auto', paused_reason = ${reason.slice(0, 500)}, paused_at = now(), updated_at = now()
         WHERE id = ${profileId}::int AND org_id = ${orgId}::uuid AND is_paused = false
           AND health_action = 'auto' AND is_default = false
        RETURNING id
    `)) as unknown as Array<{ id: number }>;
    return rows.length > 0;
}

/**
 * 풀림 알림을 받을 사업 스페이스: 이 주소가 보낸 명단의 워크스페이스 (그때까지 7일). 자동으로 멈춘 주소는 멈춘 뒤 보내지 않으므로
 * 멈춘 때(pausedAt)까지 7일을 본다 — 주말·연휴를 끼고 7일 넘게 지나 풀어도 사업 스페이스에 알린다 (HR-5).
 * 그래도 없으면 그 주소를 묶음에 둔 켜진 AI 규칙의 워크스페이스 (설계 7-2 "그 워크스페이스 규칙 묶음에 든 주소")
 */
export async function senderWorkspaceIds(orgId: string, profileId: number, until?: Date | null): Promise<number[]> {
    const end = until ?? new Date();
    // 멈춘 때에 막 나가던 메일(대기열이 이미 집은 것)도 잡도록 끝을 1시간 넉넉히 둔다
    const rows = (await db.execute(sql`
        SELECT DISTINCT p.workspace_id
        FROM email_send_logs l JOIN partitions p ON p.id = l.partition_id
        WHERE l.org_id = ${orgId}::uuid AND l.sender_profile_id = ${profileId}::int
          AND l.sent_at >= ${new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz
          AND l.sent_at <= ${new Date(end.getTime() + 60 * 60 * 1000).toISOString()}::timestamptz
    `)) as unknown as Array<{ workspace_id: number }>;
    const out = rows.map((r) => Number(r.workspace_id)).filter((n) => Number.isInteger(n) && n > 0);
    if (out.length > 0) return out;
    const pools = (await db.execute(sql`
        SELECT DISTINCT p.workspace_id
        FROM email_auto_personalized_links a JOIN partitions p ON p.id = a.partition_id JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.org_id = ${orgId}::uuid AND a.is_active = 1
          AND (a.sender_profile_id = ${profileId}::int OR COALESCE(a.sender_profile_ids, '[]'::jsonb) @> ${JSON.stringify([profileId])}::jsonb)
    `)) as unknown as Array<{ workspace_id: number }>;
    return pools.map((r) => Number(r.workspace_id)).filter((n) => Number.isInteger(n) && n > 0);
}

export type ReleaseSenderResult =
    | {
          ok: true;
          profileId: number;
          fromEmail: string;
          releasedAt: Date;
          warmupStartedOn: string | null;
          /** 풀린 뒤 오늘 한도 (null = 제한 없음) */
          todayCap: number | null;
          /** 웜업 며칠째 (웜업이 꺼졌으면 null) */
          warmupDay: number | null;
          pausedReason: string | null;
          /** 자동으로 멈춘 때 (풀림 알림을 받을 사업 스페이스를 멈추기 전 7일 발송으로 정한다, HR-5) */
          pausedAt: Date | null;
      }
    | { ok: false; status: 404 | 409; error: string };

/**
 * 자동 멈춤 풀기 (6-5). paused_source='auto'일 때만 — 손으로 멈춘 주소는 409 (발신 주소 설정에서 푼다).
 * is_paused=false, paused_* 비움, health_reset_at=now (그 뒤 발송만으로 다시 판정 — 5-2),
 * 웜업이 켜졌으면 warmup_started_on을 멈춘 동안의 보낼 수 있는 날만큼 뒤로 (shiftWarmupStart — 풀린 날 한도 = 멈춘 날 한도).
 */
export async function releaseSenderPause(orgId: string, profileId: number, now: Date = new Date()): Promise<ReleaseSenderResult> {
    return db.transaction(async (tx) => {
        const rows = (await tx.execute(sql`
            SELECT * FROM email_sender_profiles WHERE id = ${profileId}::int AND org_id = ${orgId}::uuid FOR UPDATE
        `)) as unknown as Array<Record<string, unknown>>;
        const p = rows[0];
        if (!p) return { ok: false as const, status: 404 as const, error: "발신 주소를 찾을 수 없습니다." };
        if (p.is_paused !== true || p.paused_source !== "auto") {
            return { ok: false as const, status: 409 as const, error: "자동으로 멈춘 주소가 아닙니다. 손으로 멈춘 주소는 발신 주소 설정에서 푸세요." };
        }
        const settings = toLimitSettings({
            dailyLimit: p.daily_limit as number | null,
            warmupEnabled: p.warmup_enabled as boolean,
            warmupStartCount: p.warmup_start_count as number | null,
            warmupStep: p.warmup_step as number | null,
            warmupStartedOn: p.warmup_started_on as string | null,
            sendWindowStart: p.send_window_start as number | null,
            sendWindowEnd: p.send_window_end as number | null,
            weekdaysOnly: p.weekdays_only as boolean,
            spreadEvenly: p.spread_evenly as boolean,
            isPaused: false,
        });
        const today = kstParts(now).date;
        const pausedAt = p.paused_at ? toDate(p.paused_at) : null;
        const pausedOn = pausedAt && Number.isFinite(pausedAt.getTime()) ? kstParts(pausedAt).date : null;
        const shifted = shiftWarmupStart(settings, pausedOn, today);
        await tx.execute(sql`
            UPDATE email_sender_profiles
               SET is_paused = false, paused_source = NULL, paused_reason = NULL, paused_at = NULL,
                   health_reset_at = ${now.toISOString()}::timestamptz,
                   warmup_started_on = ${shifted},
                   updated_at = now()
             WHERE id = ${profileId}::int AND org_id = ${orgId}::uuid
        `);
        const after = { ...settings, warmupStartedOn: shifted };
        return {
            ok: true as const,
            profileId,
            fromEmail: String(p.from_email ?? ""),
            releasedAt: now,
            warmupStartedOn: shifted,
            todayCap: capForDate(after, today),
            warmupDay: after.warmupEnabled ? warmupDayIndex(after, today) + 1 : null,
            pausedReason: (p.paused_reason as string | null) ?? null,
            pausedAt: pausedAt && Number.isFinite(pausedAt.getTime()) ? pausedAt : null,
        };
    });
}
