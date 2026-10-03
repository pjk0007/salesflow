import { db, queryClient, emailSendQueue, emailAutoPersonalizedLinks, emailSendLogs, records } from "@/lib/db";
import { sql, eq, and, gte, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { processAutoPersonalizedEmail } from "@/lib/auto-personalized-email";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import { getAiClient, checkTokenQuota } from "@/lib/ai";
import { getEmailConfig } from "@/lib/nhn-email";
import {
    planQueueRow,
    parseLinkIdList,
    toProcessedRow,
    recordDeletedRow,
    describePlan,
    toQueueRowWrite,
    walkQueueRow,
    deferredRecordOutcome,
    drainGroupKey,
    DRAIN_BATCH_SIZE,
    DEADLINE_BUDGET_MS,
    STUCK_THRESHOLD_MS,
    MAX_ATTEMPTS,
    isDeadlineExceeded,
} from "@/lib/email-send-queue-rules";
import type { ProcessedRow, QueueRowWrite, QueueWalk, QueueWalkLookups } from "@/lib/email-send-queue-rules";
import { describeDeferral, linkSenderPool } from "@/lib/email-sender-limit-rules";
import type { SlotDeferReason } from "@/lib/email-sender-limit-rules";
import { checkPoolsBlocked } from "@/lib/email-sender-limit";
import type { PoolBlockState } from "@/lib/email-sender-limit";
import { isDeferralOnlyBatch } from "@/lib/email-sender-limit-paths";
import type { DbRecord } from "@/lib/db";

/** scheduled-registration(0x5c4edf01)과 다른 키를 쓴다 — 두 잡은 독립적으로 돌아야 한다. */
const LOCK_KEY = 0x5c4edf02;

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
/** IN 목록·VALUES 목록 한 번의 길이 상한 (매개변수 상한 65,535보다 넉넉히 작게) */
const IN_CHUNK = 1000;
/** checkCooldown(auto-personalized-email.ts)과 같은 창 */
const COOLDOWN_MS = 60 * 60 * 1000;

export interface QueueRunStats {
    picked: number;
    sent: number;
    skipped: number;
    failed: number;
    requeued: number;
    /** 발신 주소 한도·시간대에 막혀 retryAt으로 미룬 줄 (실패가 아니라서 시도 횟수를 쓰지 않는다) */
    deferred: number;
    reclaimed: number;
    skippedAsLocked?: boolean;
    deadlineHit?: boolean;
}

interface PickedRow {
    id: number;
    record_id: number;
    partition_id: number;
    org_id: string;
    trigger_type: string;
    attempts: number;
    /** jsonb — 시도 횟수를 다 써 이 줄에서 뺀 규칙 id (parseLinkIdList로 읽는다) */
    exhausted_link_ids: unknown;
}

/** 이번 회차에 발신 한도로 미뤄진 줄이 나온 규칙 묶음 (같은 조직·파티션·트리거) */
interface DrainGroup {
    orgId: string;
    partitionId: number;
    triggerType: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 발송 큐 워커.
 *
 * 큐에 적재된 pending을 배치로 꺼내 발송한다. 한 회차가 큐를 다 비울 필요는 없다 —
 * 예산(8분)을 쓰면 남은 건 다음 회차가 이어받는다. 이 "이어받기"가 유실을 막는 핵심이다.
 *
 * 배치 줄이 발신 한도로 미뤄지면 그 규칙 묶음(조직·파티션·트리거)의 남은 줄을 drainBlockedGroup이 한꺼번에 본다 —
 * 한도에 닿은 뒤 쌓인 줄을 5건씩 줄마다 조회하며 미루지 않게. 결과(미룬 시각·건너뛴 이유)는 줄마다 처리한 것과 같다.
 */
export async function processEmailSendQueue(): Promise<QueueRunStats> {
    const stats: QueueRunStats = {
        picked: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        requeued: 0,
        deferred: 0,
        reclaimed: 0,
    };

    // 락을 잡은 커넥션에서 해제해야 하므로 전용 커넥션을 확보한다.
    // 풀에서 매번 다른 커넥션이 나오면 unlock이 다른 세션에 걸려 락이 영구히 남는다.
    const conn = await queryClient.reserve();
    let acquired = false;

    try {
        const lockResult = await conn<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_lock(${LOCK_KEY}) AS acquired
        `;
        acquired = lockResult[0]?.acquired === true;
        if (!acquired) {
            console.log("[send-queue] another worker running, skip");
            return { ...stats, skippedAsLocked: true };
        }

        stats.reclaimed = await reclaimStuck();

        const drainable = new Map<string, DrainGroup>();
        const startedAt = Date.now();
        while (!isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            // 이번 회차에 막힌 것을 본 묶음이 있으면 그 묶음의 줄부터 한꺼번에 본다.
            // NHN·AI를 부르지 않으므로 배치 사이 쉼도 없다
            const next = drainable.entries().next();
            if (!next.done) {
                const [key, group] = next.value;
                const { again } = await drainBlockedGroup(group, stats);
                if (!again) drainable.delete(key);
                continue;
            }

            const batch = await pickBatch();
            if (batch.length === 0) break;

            stats.picked += batch.length;
            const { deferredOnly, deferredGroups } = await runBatch(batch, stats);
            for (const g of deferredGroups) drainable.set(drainGroupKey(g), toDrainGroup(g));

            // 미룸만 나온 배치는 NHN을 부르지 않았으니 쉬지 않는다 — 한도에 닿은 뒤 쌓인 줄을 빨리 넘긴다
            if (!deferredOnly && !isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
                await sleep(BATCH_DELAY_MS);
            }
        }

        if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            stats.deadlineHit = true;
        }

        console.log(
            `[send-queue] picked=${stats.picked} sent=${stats.sent} skipped=${stats.skipped} ` +
            `failed=${stats.failed} requeued=${stats.requeued} deferred=${stats.deferred} ` +
            `reclaimed=${stats.reclaimed}`
        );
        return stats;
    } finally {
        if (acquired) {
            await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
        }
        conn.release();
    }
}

export interface EnqueueParams {
    recordIds: number[];
    partitionId: number;
    orgId: string;
    triggerType?: "on_create" | "on_update";
    /** 이 시각 이후에 발송한다. 생략하면 즉시. */
    scheduledAt?: Date;
}

/**
 * 발송 큐에 적재한다. 이미 큐에 있는 레코드는 건너뛴다.
 *
 * 업로드 경로와 재발송 스크립트가 함께 쓴다 — 적재 규칙이 갈리면
 * 한쪽만 고쳐져 중복 발송이 난다.
 */
export async function enqueueSends(params: EnqueueParams): Promise<number> {
    const { recordIds, partitionId, orgId, triggerType = "on_create", scheduledAt } = params;
    if (recordIds.length === 0) return 0;

    const inserted = await db
        .insert(emailSendQueue)
        .values(
            recordIds.map((recordId) => ({
                recordId,
                partitionId,
                orgId,
                triggerType,
                ...(scheduledAt ? { scheduledAt } : {}),
            })),
        )
        // 같은 레코드가 이미 큐에 있으면 넘어간다 (esq_record_trigger_idx)
        .onConflictDoNothing()
        .returning({ id: emailSendQueue.id });

    return inserted.length;
}

export interface DeferredSendParams {
    recordId: number;
    partitionId: number;
    orgId: string;
    triggerType: "on_create" | "on_update";
    retryAt: Date;
    reason: SlotDeferReason;
}

/**
 * 바로 보내는 AI 경로(dispatchAutoTriggers)가 발신 한도에 막혔을 때 그 레코드를 대기열에 retryAt으로 넣는다.
 * 넣지 않으면 그 메일은 사라진다 — 바로 보내는 경로에는 다시 시도할 곳이 없다.
 *
 * enqueueSends(DO NOTHING)를 쓰지 않는 이유: (record_id, trigger_type)이 유니크라 on_update는
 * 레코드당 평생 한 줄이다. 예전에 끝난 줄(sent·skipped·failed)이 있으면 DO NOTHING에 막혀 미룬 메일이 사라진다.
 *   끝난 줄    → pending으로 되살린다 (scheduled_at=retryAt, attempts=0, 빼 둔 규칙도 비운다 — 새 일이다)
 *   pending 줄 → 그대로 둔다. 꺼낼 때 최신 레코드를 다시 읽으므로 여러 번 고쳐도 한 통으로 합쳐진다
 *   processing → 상태는 그대로 두고 requeue_at(더 이른 쪽)만 남긴다. 워커는 고치기 전 레코드를 읽었을 수 있다 —
 *                워커가 보낼 것 없음·실패로 끝내려 하면 applyPlans가 이 시각에 다시 꺼내도록 바꾼다
 * 묶어 미루기(drainBlockedGroup)가 잡고 있는 pending 줄은 그 트랜잭션이 끝날 때까지 기다렸다가 끝난 값을 본다 —
 * 그쪽이 닫은 줄(skipped)이면 여기서 되살리고, 미룬 줄(pending)이면 그대로 둔다 (꺼낼 때 최신 레코드를 읽는다).
 */
export async function enqueueDeferredSend(params: DeferredSendParams): Promise<void> {
    const { recordId, partitionId, orgId, triggerType, retryAt, reason } = params;
    // db.execute에서는 drizzle이 시각 직렬화를 꺼 두므로 ISO 문자열로 넘기고 형을 붙인다
    const retryAtIso = retryAt.toISOString();
    const lastError = describeDeferral(reason, retryAt);

    // processing 줄은 워커가 잡고 있다 — 상태·시도·잠금을 건드리지 않고 다시 처리할 시각만 남긴다
    await db.execute(sql`
        INSERT INTO email_send_queue (record_id, partition_id, org_id, trigger_type, scheduled_at, last_error)
        VALUES (${recordId}, ${partitionId}, ${orgId}, ${triggerType}, ${retryAtIso}::timestamptz, ${lastError})
        ON CONFLICT (record_id, trigger_type) DO UPDATE
           SET status = CASE WHEN email_send_queue.status = 'processing' THEN email_send_queue.status ELSE 'pending' END,
               attempts = CASE WHEN email_send_queue.status = 'processing' THEN email_send_queue.attempts ELSE 0 END,
               scheduled_at = CASE WHEN email_send_queue.status = 'processing'
                                   THEN email_send_queue.scheduled_at ELSE EXCLUDED.scheduled_at END,
               locked_at = CASE WHEN email_send_queue.status = 'processing' THEN email_send_queue.locked_at ELSE NULL END,
               processed_at = CASE WHEN email_send_queue.status = 'processing'
                                   THEN email_send_queue.processed_at ELSE NULL END,
               last_error = CASE WHEN email_send_queue.status = 'processing'
                                 THEN email_send_queue.last_error ELSE EXCLUDED.last_error END,
               exhausted_link_ids = CASE WHEN email_send_queue.status = 'processing'
                                         THEN email_send_queue.exhausted_link_ids ELSE NULL END,
               requeue_at = CASE WHEN email_send_queue.status = 'processing'
                                 THEN LEAST(COALESCE(email_send_queue.requeue_at, EXCLUDED.scheduled_at), EXCLUDED.scheduled_at)
                                 ELSE NULL END
         WHERE email_send_queue.status IN ('sent', 'skipped', 'failed', 'processing')
    `);
}

/**
 * 워커를 즉시 한 번 깨운다. 적재 직후 호출해 cron 주기(10분)만큼 기다리지 않게 한다.
 *
 * 실패를 무시하는 이유: 이건 지연을 줄이는 최적화지 정확성의 근거가 아니다.
 * 깨움이 실패해도 큐에 남아 있고 cron이 주워간다.
 */
export function wakeSendQueue(): void {
    const secret = process.env.CRON_SECRET;
    if (!secret) return;

    const origin = process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr";
    fetch(`${origin}/api/email/queue/process`, {
        method: "POST",
        headers: { "x-secret": secret },
    }).catch((e) => console.error("[send-queue] wake failed (cron will pick up):", e));
}

/**
 * processing에서 죽은 행을 pending으로 되돌린다.
 *
 * 워커 예산이 8분이므로 정상 처리 중인 행은 그 안에 상태가 바뀐다.
 * 임계(15분)를 넘겼다면 프로세스가 죽은 것이다 — 배포·크래시가 여기 해당한다.
 */
async function reclaimStuck(): Promise<number> {
    const result = (await db.execute(sql`
        UPDATE email_send_queue
        SET status = 'pending', last_error = 'stuck: reclaimed'
        WHERE status = 'processing'
          AND locked_at < NOW() - (${STUCK_THRESHOLD_MS}::bigint * INTERVAL '1 millisecond')
          AND attempts < ${MAX_ATTEMPTS}
        RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (result.length > 0) {
        console.log(`[send-queue] reclaimed ${result.length} stuck rows`);
    }
    return result.length;
}

/**
 * pending을 원자적으로 선점한다.
 *
 * attempts를 픽업 시점에 올리는 이유: 처리 중 프로세스가 죽어도 시도가 기록되어야
 * 무한 재시도를 막을 수 있다. 처리 후에 올리면 죽을 때마다 카운트가 초기화된다.
 */
async function pickBatch(): Promise<PickedRow[]> {
    return (await db.execute(sql`
        UPDATE email_send_queue
        SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
        WHERE id IN (
            SELECT id FROM email_send_queue
            WHERE status = 'pending'
              AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC, id ASC
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, record_id, partition_id, org_id, trigger_type, attempts, exhausted_link_ids
    `)) as unknown as PickedRow[];
}

async function runBatch(
    batch: PickedRow[],
    stats: QueueRunStats
): Promise<{ deferredOnly: boolean; deferredGroups: PickedRow[] }> {
    const results = await Promise.allSettled(batch.map((row) => processRow(row)));
    const deferredFlags: boolean[] = [];
    const deferredGroups: PickedRow[] = [];
    const writes: QueueRowWrite[] = [];
    const counts = { sent: 0, skipped: 0, failed: 0, deferred: 0, requeued: 0 };

    for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const r = results[i];

        // processRow는 자체적으로 에러를 잡지만, 그 바깥(DB 조회 등)에서 던질 수 있다
        const processed: ProcessedRow =
            r.status === "fulfilled"
                ? r.value
                : {
                      outcome: "error",
                      detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
                      deferral: null,
                      failedLinkIds: [],
                  };

        const exhaustedBefore = parseLinkIdList(row.exhausted_link_ids);
        const plan = planQueueRow({
            outcome: processed.outcome,
            attempts: row.attempts,
            deferral: processed.deferral,
            failedLinkIds: processed.failedLinkIds,
            exhaustedLinkIds: exhaustedBefore,
        });
        writes.push(toQueueRowWrite(row.id, plan, describePlan(plan, processed, exhaustedBefore)));
        counts[plan.stat]++;

        // 미룸만 낸 줄(NHN·AI를 부르지 않았다)만 센다 — 실패한 규칙을 빼며 미룬 줄은 이번에 그 규칙을 돌렸다
        const pureDeferral = processed.outcome === "defer" && plan.stat === "deferred";
        deferredFlags.push(pureDeferral);
        if (pureDeferral) deferredGroups.push(row);
    }

    // 배치의 결과를 한 문장으로 쓴다 (예전: 줄마다 한 문장). 줄마다 쓰는 값은 예전과 같다
    await applyPlans(writes);
    addCounts(stats, counts);

    return { deferredOnly: isDeferralOnlyBatch(deferredFlags), deferredGroups };
}

async function processRow(row: PickedRow): Promise<ProcessedRow> {
    const [record] = await db
        .select()
        .from(records)
        .where(eq(records.id, row.record_id))
        .limit(1);

    // 레코드가 지워졌으면 보낼 대상이 없다 — 실패가 아니므로 재시도하지 않는다
    if (!record) return recordDeletedRow();

    const result = await processAutoPersonalizedEmail({
        record: record as DbRecord,
        partitionId: row.partition_id,
        triggerType: normalizeTriggerType(row.trigger_type),
        orgId: row.org_id,
        // 이 줄에서 시도 횟수를 다 쓴 규칙은 다시 돌리지 않는다 (planQueueRow)
        skipLinkIds: parseLinkIdList(row.exhausted_link_ids),
    });

    return toProcessedRow(result);
}

/** processRow와 같은 해석 — on_update가 아니면 on_create 규칙을 본다 */
function normalizeTriggerType(triggerType: string): "on_create" | "on_update" {
    return triggerType === "on_update" ? "on_update" : "on_create";
}

function toDrainGroup(row: { org_id: string; partition_id: number; trigger_type: string }): DrainGroup {
    return { orgId: row.org_id, partitionId: row.partition_id, triggerType: row.trigger_type };
}

function addCounts(
    stats: QueueRunStats,
    counts: { sent: number; skipped: number; failed: number; deferred: number; requeued: number }
): void {
    stats.sent += counts.sent;
    stats.skipped += counts.skipped;
    stats.failed += counts.failed;
    stats.deferred += counts.deferred;
    stats.requeued += counts.requeued;
}

/**
 * 처리 결과를 줄에 쓴다. 여러 줄을 한 문장으로 쓴다 — 줄마다의 값은 toQueueRowWrite가 만든다.
 * 한 문장이라 아래 requeue_at 판정과 상태 쓰기 사이에 끼어들 틈이 없다.
 *
 * 처리하는 사이 바로 보내는 경로가 이 줄을 다시 처리해 달라고 남겼으면(requeue_at, enqueueDeferredSend):
 *   보낼 것 없음·실패로 끝내려던 줄 → 끝내지 않고 requeue_at에 다시 꺼낸다 (시도 0, 빼 둔 규칙도 비운다 — 새 레코드 값으로 새 일).
 *     워커가 고치기 전 레코드를 읽고 조건 불충족으로 끝내면 고친 뒤 미룬 메일이 사라진다
 *   보낸 줄(sent)       → 다시 꺼내지 않는다. 쿨다운(1시간)이 원래 막았을 두 번째 메일이 나중에 나가지 않게
 *   다시 꺼낼 줄(pending) → 둘 중 이른 시각에. 꺼낼 때 최신 레코드를 다시 읽으므로 따로 할 일이 없다
 * 이 문장의 SET 식은 모두 바꾸기 전 값(requeue_at 포함)을 본다.
 *
 * run: 트랜잭션 안에서 쓸 때(묶어 미루기) 그 트랜잭션의 execute를 넘긴다.
 */
async function applyPlans(
    writes: readonly QueueRowWrite[],
    run: (query: SQL) => Promise<unknown> = (query) => db.execute(query)
): Promise<void> {
    if (writes.length === 0) return;
    await run(sql`
        UPDATE email_send_queue AS q SET
            status = CASE WHEN v.revivable AND q.requeue_at IS NOT NULL THEN 'pending' ELSE v.status END,
            attempts = CASE WHEN v.revivable AND q.requeue_at IS NOT NULL THEN 0 ELSE v.attempts END,
            scheduled_at = CASE
                WHEN v.revivable AND q.requeue_at IS NOT NULL THEN q.requeue_at
                WHEN v.pending AND q.requeue_at IS NOT NULL
                    THEN LEAST(COALESCE(v.scheduled_at, q.scheduled_at), q.requeue_at)
                ELSE COALESCE(v.scheduled_at, q.scheduled_at) END,
            exhausted_link_ids = CASE WHEN v.revivable AND q.requeue_at IS NOT NULL THEN NULL ELSE v.exhausted END,
            -- pending으로 되돌릴 때 locked_at을 비워야 stuck 판정에 다시 걸리지 않는다
            locked_at = CASE WHEN v.pending OR (v.revivable AND q.requeue_at IS NOT NULL) THEN NULL
                             WHEN v.stamp_lock THEN NOW()
                             ELSE q.locked_at END,
            -- 끝난 줄만 처리 시각을 남긴다 (pending은 아직 끝나지 않았다)
            processed_at = CASE WHEN v.revivable AND q.requeue_at IS NOT NULL THEN NULL
                                WHEN v.pending THEN q.processed_at
                                ELSE NOW() END,
            last_error = v.last_error,
            requeue_at = NULL
        FROM jsonb_to_recordset(${JSON.stringify(writes)}::jsonb)
             AS v(id int, status varchar, attempts int, scheduled_at timestamptz, exhausted jsonb,
                  revivable boolean, pending boolean, last_error text, stamp_lock boolean)
        WHERE q.id = v.id
    `);
}

// ============================================
// 막힌 묶음의 줄을 한꺼번에 처리 (설계: docs/2026-10-02-sender-warmup/DESIGN.md 6절 대기열)
// ============================================

interface DrainRow {
    id: number;
    record_id: number;
    partition_id: number;
    org_id: string;
    trigger_type: string;
    attempts: number;
    exhausted_link_ids: unknown;
    record_exists: boolean;
    record_data: unknown;
    workspace_id: number | null;
}

type AutoLink = typeof emailAutoPersonalizedLinks.$inferSelect;

/**
 * 같은 규칙 묶음(조직·파티션·트리거)의 꺼낼 때가 된 줄을 최대 DRAIN_BATCH_SIZE개 한꺼번에 본다.
 *
 * 줄마다 processAutoPersonalizedEmail을 부르는 대신, 그 함수가 읽는 값(레코드·규칙·쿨다운·중복 수신자·수신거부·
 * 워크스페이스·토큰 쿼터·메일 설정·발신 주소와 오늘 사용량)을 묶음마다 한 번씩 읽고 walkQueueRow로 같은 순서를 따라간다.
 * 결과가 미룸·건너뜀인 줄만 여기서 끝낸다 — 그 줄은 줄마다 처리했어도 같은 규칙별 결과가 나온다 (walkQueueRow 설명).
 * 미룬 시각은 줄 순서대로 checkPoolsBlocked의 nextRetryAt()으로 받는다 — claimSender를 줄마다 부른 것과 같은 값이다
 * (간격 미룸 펼치기 포함). 시도 횟수·last_error·뺀 규칙도 planQueueRow·describePlan·applyPlans로 줄마다 처리와 같게 쓴다.
 * 보낼 수 있는 줄(주소가 열림)·판단할 수 없는 값이 있는 줄은 건드리지 않는다 — 잠금만 풀려 pending 그대로 남고
 * 다음 pickBatch가 줄마다 처리한다. 그런 줄이 하나라도 있으면 이 묶음은 이번 회차에 더 묶어 보지 않는다.
 *
 * 줄을 꺼내 processing으로 바꾸지 않고 트랜잭션 안에서 FOR UPDATE로 잡는다 — 프로세스가 죽으면 아무것도 바뀌지 않는다
 * (꺼냈다면 시도 1이 쓰인 채 15분 뒤 회수된다). 시도 횟수는 꺼냈을 때의 값(+1)으로 planQueueRow에 넘겨 같은 값을 쓴다.
 * 오류가 나면 되돌리고 묶음 처리를 멈춘다 — 그 줄들은 줄마다 처리로 간다.
 */
async function drainBlockedGroup(group: DrainGroup, stats: QueueRunStats): Promise<{ again: boolean }> {
    try {
        const done = await db.transaction(async (tx) => {
            const rows = (await tx.execute(sql`
                SELECT q.id, q.record_id, q.partition_id, q.org_id, q.trigger_type, q.attempts, q.exhausted_link_ids,
                       (r.id IS NOT NULL) AS record_exists, r.data AS record_data, p.workspace_id
                FROM email_send_queue q
                LEFT JOIN records r ON r.id = q.record_id
                LEFT JOIN partitions p ON p.id = q.partition_id
                WHERE q.status = 'pending'
                  AND q.scheduled_at <= NOW()
                  AND q.org_id = ${group.orgId}
                  AND q.partition_id = ${group.partitionId}
                  AND q.trigger_type = ${group.triggerType}
                ORDER BY q.scheduled_at ASC, q.id ASC
                LIMIT ${DRAIN_BATCH_SIZE}
                FOR UPDATE OF q SKIP LOCKED
            `)) as unknown as DrainRow[];
            if (rows.length === 0) return { rows: 0, writes: [] as QueueRowWrite[], counts: null, left: 0 };

            const resolved = await resolveDrainRows(group, rows);
            const counts = { sent: 0, skipped: 0, failed: 0, deferred: 0, requeued: 0 };
            const writes: QueueRowWrite[] = [];
            for (const row of rows) {
                const processed = resolved.get(row.id);
                if (!processed) continue;
                const exhaustedBefore = parseLinkIdList(row.exhausted_link_ids);
                const plan = planQueueRow({
                    outcome: processed.outcome,
                    // 꺼냈다면(pickBatch) 올라 있었을 값 — 미룸은 이 값에서 1을 되돌린다
                    attempts: row.attempts + 1,
                    deferral: processed.deferral,
                    failedLinkIds: processed.failedLinkIds,
                    exhaustedLinkIds: exhaustedBefore,
                });
                writes.push(
                    toQueueRowWrite(row.id, plan, describePlan(plan, processed, exhaustedBefore), { stampLock: true })
                );
                counts[plan.stat]++;
            }
            await applyPlans(writes, (query) => tx.execute(query));
            return { rows: rows.length, writes, counts, left: rows.length - writes.length };
        });

        if (done.counts) {
            stats.picked += done.writes.length;
            addCounts(stats, done.counts);
            console.log(
                `[send-queue] 묶어 처리 org=${group.orgId} partition=${group.partitionId} trigger=${group.triggerType} ` +
                `rows=${done.rows} deferred=${done.counts.deferred} skipped=${done.counts.skipped} ` +
                `failed=${done.counts.failed} 줄마다처리로남김=${done.left}`
            );
        }
        // 다 끝냈고 상한만큼 찼으면 남은 줄이 더 있을 수 있다
        return { again: done.rows === DRAIN_BATCH_SIZE && done.left === 0 };
    } catch (e) {
        console.error(
            `[send-queue] 묶어 처리 실패 — 줄마다 처리로 넘김 (org=${group.orgId} partition=${group.partitionId}):`,
            e
        );
        return { again: false };
    }
}

/**
 * 줄마다 walkQueueRow를 돌려 여기서 끝낼 수 있는 줄의 처리 결과를 만든다 (끝낼 수 없는 줄은 Map에 없다).
 * 읽는 값은 processAutoPersonalizedEmail이 그 조회를 하는 자리에 어떤 줄이라도 닿았을 때만 읽는다 —
 * 토큰 쿼터(없으면 그달 줄을 만든다)·메일 설정·발신 주소 순서도 그 함수와 같다.
 */
async function resolveDrainRows(group: DrainGroup, rows: DrainRow[]): Promise<Map<number, ProcessedRow>> {
    const out = new Map<number, ProcessedRow>();

    // processAutoPersonalizedEmail의 규칙 조회와 같은 조건·같은 순서(id)
    const links: AutoLink[] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.partitionId, group.partitionId),
                eq(emailAutoPersonalizedLinks.triggerType, normalizeTriggerType(group.triggerType)),
                eq(emailAutoPersonalizedLinks.isActive, 1)
            )
        )
        .orderBy(emailAutoPersonalizedLinks.id);
    const linkById = new Map(links.map((l) => [l.id, l]));

    const live = rows.filter((r) => r.record_exists);
    const dataOf = (row: DrainRow): Record<string, unknown> | null =>
        typeof row.record_data === "object" && row.record_data !== null && !Array.isArray(row.record_data)
            ? (row.record_data as Record<string, unknown>)
            : null;

    // 받는 주소 후보 (규칙마다 recipientField 값). 중복 확인은 preventDuplicate 규칙의 문자열 값만, 수신거부는 메일 모양인 값만
    const dupEmails = new Set<string>();
    const unsubEmails = new Set<string>();
    for (const row of live) {
        const data = dataOf(row);
        if (!data) continue;
        for (const link of links) {
            const v = data[link.recipientField];
            if (typeof v !== "string" || !v) continue;
            if (link.preventDuplicate) dupEmails.add(v);
            if (v.includes("@")) unsubEmails.add(v);
        }
    }
    const workspaceId = live.find((r) => r.workspace_id !== null)?.workspace_id ?? null;

    const [cooldownIds, duplicates, unsubscribed] =
        links.length > 0 && live.length > 0
            ? await Promise.all([
                  loadCooldownRecordIds(live.map((r) => r.record_id)),
                  loadDuplicateRecipients(group.partitionId, [...dupEmails]),
                  workspaceId !== null ? loadUnsubscribedEmails(workspaceId, [...unsubEmails]) : Promise.resolve(new Set<string>()),
              ])
            : [new Set<number>(), new Set<string>(), new Set<string>()];

    const aiReady = new Map<string, boolean>();
    const aiClientReady = (model: string | undefined): boolean => {
        const key = model ?? "";
        let ready = aiReady.get(key);
        if (ready === undefined) {
            ready = getAiClient(model) !== null;
            aiReady.set(key, ready);
        }
        return ready;
    };

    let quotaAllowed: boolean | undefined;
    let emailConfig: Awaited<ReturnType<typeof getEmailConfig>> | undefined;
    let blocks: Map<number, PoolBlockState> | undefined;

    const lookupsFor = (row: DrainRow): QueueWalkLookups => ({
        conditionMet: (link) =>
            evaluateCondition(
                linkById.get(link.id)?.triggerCondition as Parameters<typeof evaluateCondition>[0],
                row.record_data as Record<string, unknown>
            ),
        cooldownActive: cooldownIds.has(row.record_id),
        isDuplicate: (email) => (dupEmails.has(email) ? duplicates.has(email) : undefined),
        workspaceId: row.workspace_id,
        isUnsubscribed: (email) =>
            row.workspace_id === workspaceId && unsubEmails.has(email) ? unsubscribed.has(email) : undefined,
        aiClientReady,
        quotaAllowed,
        emailClientReady: emailConfig === undefined ? undefined : emailConfig !== null,
        poolBlock: (link) => {
            if (!blocks) return undefined;
            const state = blocks.get(link.id);
            if (!state) return undefined;
            return state.blocked ? { blocked: true, reason: state.reason } : { blocked: false };
        },
    });

    let walks: Array<QueueWalk | null> = [];
    // 읽을 값은 쿼터 → 메일 설정 → 발신 주소 순으로만 생긴다 (원래 흐름의 순서). 세 번 읽으면 더 생기지 않는다
    for (let round = 0; round < 4; round++) {
        walks = rows.map((row) =>
            row.record_exists
                ? walkQueueRow(
                      { data: row.record_data, links, skipLinkIds: parseLinkIdList(row.exhausted_link_ids) },
                      lookupsFor(row)
                  )
                : null
        );
        const needs = new Set(walks.flatMap((w) => (w?.kind === "need" ? [w.need] : [])));
        if (needs.size === 0) break;
        if (needs.has("quota")) {
            quotaAllowed = (await checkTokenQuota(group.orgId)).allowed;
        } else if (needs.has("emailClient")) {
            emailConfig = await getEmailConfig(group.orgId);
        } else {
            // claimSender와 같은 설정·같은 묶음(linkSenderPool)으로 규칙마다 본다 — 주소·사용량은 한 번만 읽는다
            const states = await checkPoolsBlocked(
                group.orgId,
                links.map((l) => linkSenderPool(l)),
                { config: emailConfig ?? null, spreadDeferrals: true }
            );
            blocks = new Map(links.map((l, i) => [l.id, states[i]]));
        }
    }

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const walk = walks[i];
        if (!row.record_exists) {
            out.set(row.id, recordDeletedRow());
            continue;
        }
        if (!walk) continue;
        if (walk.kind === "skip") {
            out.set(row.id, toProcessedRow(walk.result));
        } else if (walk.kind === "defer") {
            const state = blocks?.get(walk.linkId);
            if (!state || !state.blocked) continue;
            // 줄 순서대로 부른다 — claimSender를 줄마다 부른 것과 같은 retryAt (간격 미룸이면 순번만큼 펼친다)
            out.set(row.id, toProcessedRow(deferredRecordOutcome(walk, state.nextRetryAt())));
        }
        // need(읽기 끝에도 남음)·process → 줄마다 처리
    }
    return out;
}

/** checkCooldown과 같은 조건: 1시간 안에 ai_auto 발송(sent·pending) 이력이 있는 레코드 */
async function loadCooldownRecordIds(recordIds: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    const since = new Date(Date.now() - COOLDOWN_MS);
    for (let i = 0; i < recordIds.length; i += IN_CHUNK) {
        const rows = await db
            .selectDistinct({ recordId: emailSendLogs.recordId })
            .from(emailSendLogs)
            .where(
                and(
                    inArray(emailSendLogs.recordId, recordIds.slice(i, i + IN_CHUNK)),
                    eq(emailSendLogs.triggerType, "ai_auto"),
                    gte(emailSendLogs.sentAt, since),
                    inArray(emailSendLogs.status, ["sent", "pending"])
                )
            );
        for (const r of rows) if (r.recordId !== null) out.add(r.recordId);
    }
    return out;
}

/** checkDuplicateRecipientForAiAuto와 같은 조건: 같은 파티션·같은 받는 주소(그대로 비교)로 ai_auto를 보낸 적이 있다 */
async function loadDuplicateRecipients(partitionId: number, emails: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < emails.length; i += IN_CHUNK) {
        const rows = await db
            .selectDistinct({ email: emailSendLogs.recipientEmail })
            .from(emailSendLogs)
            .where(
                and(
                    eq(emailSendLogs.partitionId, partitionId),
                    inArray(emailSendLogs.recipientEmail, emails.slice(i, i + IN_CHUNK)),
                    eq(emailSendLogs.triggerType, "ai_auto"),
                    eq(emailSendLogs.status, "sent")
                )
            );
        for (const r of rows) out.add(r.email);
    }
    return out;
}

/**
 * isUnsubscribed와 같은 조건(같은 워크스페이스, lower(email) = lower(값))으로 거부한 받는 주소.
 * 값을 VALUES로 넘겨 SQL의 lower로 비교한다 — JS 소문자와 Postgres lower가 다를 수 있는 글자에서도 같은 답이 나오게
 */
async function loadUnsubscribedEmails(workspaceId: number, emails: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < emails.length; i += IN_CHUNK) {
        const part = emails.slice(i, i + IN_CHUNK);
        const rows = (await db.execute(sql`
            SELECT v.email
            FROM (VALUES ${sql.join(part.map((e) => sql`(${e}::text)`), sql`, `)}) AS v(email)
            WHERE EXISTS (
                SELECT 1 FROM email_unsubscribes u
                WHERE u.workspace_id = ${workspaceId}
                  AND lower(u.email) = lower(v.email)
            )
        `)) as unknown as Array<{ email: string }>;
        for (const r of rows) out.add(r.email);
    }
    return out;
}
