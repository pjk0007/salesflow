import { db, queryClient, emailSendQueue } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { processAutoPersonalizedEmail } from "@/lib/auto-personalized-email";
import { foldOutcome, describeOutcome } from "@/lib/auto-personalized-email-outcome";
import {
    nextStatus,
    DEADLINE_BUDGET_MS,
    STUCK_THRESHOLD_MS,
    MAX_ATTEMPTS,
    isDeadlineExceeded,
} from "@/lib/email-send-queue-rules";
import { records } from "@/lib/db";
import type { DbRecord } from "@/lib/db";

/** scheduled-registration(0x5c4edf01)과 다른 키를 쓴다 — 두 잡은 독립적으로 돌아야 한다. */
const LOCK_KEY = 0x5c4edf02;

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

export interface QueueRunStats {
    picked: number;
    sent: number;
    skipped: number;
    failed: number;
    requeued: number;
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 발송 큐 워커.
 *
 * 큐에 적재된 pending을 배치로 꺼내 발송한다. 한 회차가 큐를 다 비울 필요는 없다 —
 * 예산(8분)을 쓰면 남은 건 다음 회차가 이어받는다. 이 "이어받기"가 유실을 막는 핵심이다.
 */
export async function processEmailSendQueue(): Promise<QueueRunStats> {
    const stats: QueueRunStats = { picked: 0, sent: 0, skipped: 0, failed: 0, requeued: 0, reclaimed: 0 };

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

        const startedAt = Date.now();
        while (!isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            const batch = await pickBatch();
            if (batch.length === 0) break;

            stats.picked += batch.length;
            await runBatch(batch, stats);

            if (!isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
                await sleep(BATCH_DELAY_MS);
            }
        }

        if (isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS)) {
            stats.deadlineHit = true;
        }

        console.log(
            `[send-queue] picked=${stats.picked} sent=${stats.sent} skipped=${stats.skipped} ` +
            `failed=${stats.failed} requeued=${stats.requeued} reclaimed=${stats.reclaimed}`
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
        RETURNING id, record_id, partition_id, org_id, trigger_type, attempts
    `)) as unknown as PickedRow[];
}

async function runBatch(batch: PickedRow[], stats: QueueRunStats): Promise<void> {
    const results = await Promise.allSettled(batch.map((row) => processRow(row)));

    for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const r = results[i];

        // processRow는 자체적으로 에러를 잡지만, 그 바깥(DB 조회 등)에서 던질 수 있다
        const outcome = r.status === "fulfilled" ? r.value.outcome : "error";
        const detail =
            r.status === "fulfilled"
                ? r.value.detail
                : r.reason instanceof Error
                  ? r.reason.message
                  : String(r.reason);

        const status = nextStatus(outcome, row.attempts);
        await applyStatus(row.id, status, detail);

        if (status === "sent") stats.sent++;
        else if (status === "skipped") stats.skipped++;
        else if (status === "failed") stats.failed++;
        else stats.requeued++;
    }
}

async function processRow(row: PickedRow): Promise<{ outcome: "ok" | "skip" | "error"; detail: string }> {
    const [record] = await db
        .select()
        .from(records)
        .where(eq(records.id, row.record_id))
        .limit(1);

    // 레코드가 지워졌으면 보낼 대상이 없다 — 실패가 아니므로 재시도하지 않는다
    if (!record) {
        return { outcome: "skip", detail: "record deleted" };
    }

    const result = await processAutoPersonalizedEmail({
        record: record as DbRecord,
        partitionId: row.partition_id,
        triggerType: row.trigger_type === "on_update" ? "on_update" : "on_create",
        orgId: row.org_id,
    });

    return { outcome: foldOutcome(result), detail: describeOutcome(result) };
}

async function applyStatus(id: number, status: string, detail: string): Promise<void> {
    await db
        .update(emailSendQueue)
        .set({
            status,
            lastError: status === "sent" ? null : detail.slice(0, 2000),
            // pending으로 되돌릴 때 lockedAt을 비워야 stuck 판정에 다시 걸리지 않는다
            lockedAt: status === "pending" ? null : undefined,
            processedAt: status === "pending" ? undefined : new Date(),
        })
        .where(eq(emailSendQueue.id, id));
}
