import { db, queryClient, partitions, workspaces, scheduledRegistrations } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { insertImportedRecords, dispatchImportTriggers } from "@/lib/record-import";
import type { DbRecord } from "@/lib/db";

const LOCK_KEY = 0x5c4edf01; // scheduled-registration advisory lock 전용 키

export interface ScheduledRegConfig {
    enabled: boolean;
    timeOfDay: string; // "HH:mm" (KST)
    countPerDay: number;
    lastRunDate?: string; // "YYYY-MM-DD"
}

/**
 * 사용자 입력 config를 저장 가능한 형태로 정규화한다.
 * 파티션 PATCH와 예약 등록 전용 config 경로가 같은 규칙을 쓰도록 여기에 둔다.
 */
export function normalizeScheduledConfig(
    input: unknown,
    prev: ScheduledRegConfig | null
): { ok: true; config: ScheduledRegConfig } | { ok: false; error: string } {
    if (typeof input !== "object" || input === null) {
        return { ok: false, error: "예약 등록 설정이 올바르지 않습니다." };
    }
    const raw = input as Record<string, unknown>;

    const timeOfDay = String(raw.timeOfDay || "09:00");
    if (!/^\d{2}:\d{2}$/.test(timeOfDay)) {
        return { ok: false, error: "실행 시각 형식이 올바르지 않습니다 (HH:mm)." };
    }

    const countPerDay = Math.max(1, Number(raw.countPerDay) || 0);

    return {
        ok: true,
        config: {
            enabled: Boolean(raw.enabled),
            timeOfDay,
            countPerDay,
            // 설정 변경 시 마지막 실행일 유지 (하루 1회 보장 유지)
            ...(prev?.lastRunDate ? { lastRunDate: prev.lastRunDate } : {}),
        },
    };
}

export interface ScheduledRegStats {
    duePartitions: number;
    registered: number;
    skippedAsLocked?: boolean;
}

/** KST 벽시계 — { date: "YYYY-MM-DD", hhmm: "HH:mm" } */
function nowKst(): { date: string; hhmm: string } {
    const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
    const iso = shifted.toISOString();
    return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}

/**
 * 예약 등록 일일 잡.
 * 외부 스케줄러가 주기적으로(예: 10분/1시간) 호출. 각 파티션의 timeOfDay 가 지났고
 * 오늘 아직 실행하지 않았으면 pending 큐에서 countPerDay 개를 레코드로 등록한다.
 */
export async function processScheduledRegistrations(): Promise<ScheduledRegStats> {
    const stats: ScheduledRegStats = { duePartitions: 0, registered: 0 };

    // advisory lock (크론 겹침 방지) — 잡은 그 커넥션에서 해제해야 하므로 전용 커넥션 reserve.
    const conn = await queryClient.reserve();
    let acquired = false;
    try {
        const lockResult = await conn<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_lock(${LOCK_KEY}) AS acquired
        `;
        acquired = lockResult[0]?.acquired === true;
        if (!acquired) {
            console.log("[scheduled-reg] another instance running, skip");
            return { ...stats, skippedAsLocked: true };
        }

        const { date: todayKst, hhmm } = nowKst();

        // 설정이 있는 파티션 + orgId(워크스페이스 경유) 조회
        const rows = await db
            .select({ partition: partitions, orgId: workspaces.orgId })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(sql`${partitions.scheduledRegistrationConfig} IS NOT NULL`);

        for (const { partition, orgId } of rows) {
            const config = partition.scheduledRegistrationConfig as ScheduledRegConfig | null;
            if (!config?.enabled) continue;
            if (!config.timeOfDay || !config.countPerDay || config.countPerDay <= 0) continue;
            // 오늘 이미 실행했으면 skip
            if (config.lastRunDate === todayKst) continue;
            // 아직 실행 시각 전이면 skip
            if (hhmm < config.timeOfDay) continue;

            stats.duePartitions++;
            try {
                const registered = await registerForPartition(partition, orgId, config.countPerDay);
                stats.registered += registered.count;
                // 트리거는 커밋 후 fire-and-forget (규칙 있을 때만 레코드별 발동)
                if (registered.insertedRecords.length > 0) {
                    dispatchImportTriggers(registered.insertedRecords, { partitionId: partition.id, orgId })
                        .catch((e) => console.error("[scheduled-reg] dispatch triggers error:", e));
                }
                console.log(`[scheduled-reg] partition ${partition.id}: registered ${registered.count}`);
            } catch (err) {
                console.error(`[scheduled-reg] partition ${partition.id} error:`, err);
            }
        }

        return stats;
    } finally {
        if (acquired) {
            await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
        }
        conn.release();
    }
}

interface RegisterResult {
    count: number;
    insertedRecords: DbRecord[];
}

/**
 * 한 파티션에 대해 pending 큐에서 limit 개를 픽업해 레코드로 등록하고,
 * 큐 행을 registered 로 마킹 + 파티션 lastRunDate 갱신 (모두 한 트랜잭션).
 */
async function registerForPartition(
    partition: typeof partitions.$inferSelect,
    orgId: string,
    limit: number,
): Promise<RegisterResult> {
    const { date: todayKst } = nowKst();

    return db.transaction(async (tx) => {
        // pending 픽업 (FIFO=id asc) + 동시성 보호
        const picked = (await tx.execute(sql`
            SELECT id, data FROM scheduled_registrations
            WHERE partition_id = ${partition.id} AND status = 'pending'
            ORDER BY id ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        `)) as unknown as Array<{ id: number; data: Record<string, unknown> }>;

        // 처리 결과와 무관하게 오늘 실행 표시 (하루 1회 보장)
        const markRun = tx
            .update(partitions)
            .set({
                scheduledRegistrationConfig: {
                    ...(partition.scheduledRegistrationConfig as ScheduledRegConfig),
                    lastRunDate: todayKst,
                },
                updatedAt: new Date(),
            })
            .where(eq(partitions.id, partition.id));

        if (picked.length === 0) {
            await markRun;
            return { count: 0, insertedRecords: [] };
        }

        const result = await insertImportedRecords(tx, {
            orgId,
            partition: {
                id: partition.id,
                workspaceId: partition.workspaceId,
                duplicateConfig: partition.duplicateConfig as { field: string; action: string } | null,
                duplicateCheckField: partition.duplicateCheckField,
            },
            dataRows: picked.map((p) => p.data),
            duplicateAction: "skip",
        });

        // 픽업한 큐 행을 대기에서 뺀다 — 등록(병합 포함)은 'registered', 중복으로 건너뛴 행은 'skipped'로 남겨
        // 대기 목록의 '건너뜀' 보기에서 어떤 행이 빠졌는지 확인할 수 있게 한다(UX-078)
        const { registeredIds, skippedIds } = splitPickedByOutcome(picked.map((p) => p.id), result.skippedRows);
        for (const [status, ids] of [["registered", registeredIds], ["skipped", skippedIds]] as const) {
            if (ids.length === 0) continue;
            await tx.execute(sql`
                UPDATE scheduled_registrations
                SET status = ${status}, registered_at = NOW()
                WHERE id = ANY(${sql`ARRAY[${sql.join(ids, sql`, `)}]::int[]`})
            `);
        }

        await markRun;

        return { count: result.insertedCount, insertedRecords: result.insertedRecords };
    });
}

/** 픽업한 큐 id를 등록/건너뜀으로 나눈다 — skippedRows는 picked 순서의 위치(insertImportedRecords 결과) */
export function splitPickedByOutcome(pickedIds: number[], skippedRows: number[]): { registeredIds: number[]; skippedIds: number[] } {
    const skipped = new Set(skippedRows);
    return {
        registeredIds: pickedIds.filter((_, i) => !skipped.has(i)),
        skippedIds: pickedIds.filter((_, i) => skipped.has(i)),
    };
}
