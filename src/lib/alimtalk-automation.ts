import { db, alimtalkTemplateLinks, alimtalkSendLogs, alimtalkAutomationQueue, alimtalkFollowupQueue, records } from "@/lib/db";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";
import type { DbRecord, AlimtalkTemplateLink } from "@/lib/db";

// ============================================
// 후속발송 상수
// ============================================
const FOLLOWUP_CRON_LOCK_KEY = 0x4f57a70b; // alimtalk-followup advisory lock 전용 키
const PICKUP_LIMIT = 5000;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10분
const PROCESS_TIMEOUT_MS = 8 * 60 * 1000; // 8분
const IDEMPOTENCY_WINDOW_MS = 60 * 60 * 1000; // 1시간

// 후속발송 sendAt 계산 (delayDays + delayHours + delayMinutes 합산)
function computeFollowupSendAt(
    baseAt: Date,
    config: {
        delayDays?: number;
        delayHours?: number;
        delayMinutes?: number;
    }
): Date {
    const totalMs =
        (config.delayDays ?? 0) * 86_400_000 +
        (config.delayHours ?? 0) * 3_600_000 +
        (config.delayMinutes ?? 0) * 60_000;
    // 0이면 기본 1일 (안전장치)
    const finalMs = totalMs > 0 ? totalMs : 86_400_000;
    return new Date(baseAt.getTime() + finalMs);
}

// 큐 항목 종료 처리
async function closeQueueItem(id: number, status: "sent" | "failed") {
    await db
        .update(alimtalkFollowupQueue)
        .set({ status, processedAt: new Date() })
        .where(eq(alimtalkFollowupQueue.id, id));
}

// ============================================
// 후속발송 다단계 (multistep) 헬퍼
// ============================================

interface FollowupStep {
    delayDays?: number;
    delayHours?: number;
    delayMinutes?: number;
    templateCode: string;
    templateName?: string;
    variableMappings?: Record<string, string>;
}

/** followupConfig를 배열로 정규화 (단일 객체 → 1개짜리 배열) */
function normalizeFollowupConfig(config: unknown): FollowupStep[] {
    if (!config) return [];
    if (Array.isArray(config)) return config as FollowupStep[];
    return [config as FollowupStep];
}

/** 후속발송 큐에 step 등록 (UNIQUE INDEX로 같은 parent+step 중복 방지) */
async function enqueueFollowupStep(params: {
    parentLogId: number;
    templateLinkId: number;
    orgId: string;
    baseAt: Date;
    step: FollowupStep;
    stepIndex: number;
}): Promise<void> {
    const sendAt = computeFollowupSendAt(params.baseAt, params.step);
    await db
        .insert(alimtalkFollowupQueue)
        .values({
            parentLogId: params.parentLogId,
            templateLinkId: params.templateLinkId,
            orgId: params.orgId,
            sendAt,
            stepIndex: params.stepIndex,
            status: "pending",
        })
        .onConflictDoNothing();
    console.log(
        `[alimtalk] followup step ${params.stepIndex} enqueued for log ${params.parentLogId}, sendAt: ${sendAt.toISOString()}`
    );
}

// ============================================
// 조건 평가
// ============================================

interface TriggerCondition {
    field?: string;
    operator?: "eq" | "ne" | "contains";
    value?: string;
}

export function evaluateCondition(
    condition: TriggerCondition | null | undefined,
    data: Record<string, unknown>
): boolean {
    if (!condition || !condition.field) return true;

    const fieldValue = String(data[condition.field] ?? "");
    const targetValue = condition.value ?? "";
    const operator = condition.operator ?? "eq";

    switch (operator) {
        case "eq":
            return fieldValue === targetValue;
        case "ne":
            return fieldValue !== targetValue;
        case "contains":
            // 콤마 구분 멀티값: "테스트,구독중" → 필드값이 그 중 하나에 일치하면 true
            if (targetValue.includes(",")) {
                return targetValue.split(",").some((v) => v.trim() === fieldValue);
            }
            return fieldValue.includes(targetValue);
        default:
            return false;
    }
}

// ============================================
// 쿨다운 체크 (중복 발송 방지)
// ============================================

async function checkCooldown(
    recordId: number,
    templateLinkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const [existing] = await db
        .select({ id: alimtalkSendLogs.id })
        .from(alimtalkSendLogs)
        .where(
            and(
                eq(alimtalkSendLogs.recordId, recordId),
                eq(alimtalkSendLogs.templateLinkId, templateLinkId),
                gte(alimtalkSendLogs.sentAt, since),
                inArray(alimtalkSendLogs.status, ["sent", "pending"])
            )
        )
        .limit(1);

    return !existing; // true = 발송 허용, false = 쿨다운 중
}

// ============================================
// 단건 자동 발송
// ============================================

async function sendSingle(
    link: AlimtalkTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat" | "followup",
    stepIndex: number = 0
): Promise<number | null> {
    const client = await getAlimtalkClient(orgId);
    if (!client) {
        console.log(`[alimtalk] sendSingle failed: no NHN client for org ${orgId}`);
        return null;
    }

    const data = record.data as Record<string, unknown>;
    const phone = data[link.recipientField];
    if (!phone || typeof phone !== "string") {
        console.log(`[alimtalk] sendSingle failed: no phone in field "${link.recipientField}", got: ${JSON.stringify(phone)}`);
        return null;
    }

    const recipientNo = normalizePhoneNumber(phone);
    if (recipientNo.length < 10) return null;

    // 변수 매핑
    let templateParameter: Record<string, string> | undefined;
    const mappings = link.variableMappings as Record<string, string> | null;
    if (mappings && Object.keys(mappings).length > 0) {
        templateParameter = {};
        for (const [variable, fieldKey] of Object.entries(mappings)) {
            const paramKey = variable.replace(/^#\{|\}$/g, "");
            let val = data[fieldKey] != null ? String(data[fieldKey]) : "";
            // ISO 날짜 → YYYY-MM-DD 변환 (알림톡 14자 제한 대응)
            if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
                val = val.slice(0, 10);
            }
            templateParameter[paramKey] = val;
        }
    }

    // 템플릿 본문 조회 + 변수 치환
    const templateDetail = await client.getTemplate(link.senderKey, link.templateCode);
    let content = templateDetail?.template?.templateContent || "";
    if (templateParameter) {
        for (const [key, value] of Object.entries(templateParameter)) {
            content = content.replaceAll(`#{${key}}`, value);
        }
    }

    const nhnResult = await client.sendMessages({
        senderKey: link.senderKey,
        templateCode: link.templateCode,
        recipientList: [{ recipientNo, templateParameter }],
    });

    const isSuccess = nhnResult.header.isSuccessful;
    const sendResult = nhnResult.message?.sendResults?.[0];

    const [log] = await db.insert(alimtalkSendLogs).values({
        orgId,
        templateLinkId: link.id,
        partitionId: link.partitionId,
        recordId: record.id,
        senderKey: link.senderKey,
        templateCode: link.templateCode,
        templateName: link.templateName || "",
        recipientNo,
        requestId: nhnResult.message?.requestId,
        recipientSeq: sendResult?.recipientSeq,
        status: isSuccess ? "sent" : "failed",
        resultCode: sendResult ? String(sendResult.resultCode) : null,
        resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        content,
        triggerType,
        stepIndex,
        sentAt: new Date(),
    }).returning({ id: alimtalkSendLogs.id });

    return isSuccess ? log.id : null;
}

// ============================================
// 자동 트리거 처리 (레코드 생성/수정 후 호출)
// ============================================

interface AutoTriggerParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processAutoTrigger(params: AutoTriggerParams): Promise<void> {
    const { record, partitionId, triggerType, orgId } = params;

    // 해당 파티션의 매칭 triggerType을 가진 active 링크 조회
    const links = await db
        .select()
        .from(alimtalkTemplateLinks)
        .where(
            and(
                eq(alimtalkTemplateLinks.partitionId, partitionId),
                eq(alimtalkTemplateLinks.triggerType, triggerType),
                eq(alimtalkTemplateLinks.isActive, 1)
            )
        );

    console.log(`[alimtalk] trigger: ${triggerType}, partition: ${partitionId}, record: ${record.id}, links: ${links.length}`);
    if (links.length === 0) return;

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        // 조건 평가
        if (!evaluateCondition(link.triggerCondition as TriggerCondition | null, data)) {
            console.log(`[alimtalk] skip link ${link.id} (${link.name}): condition not met`);
            continue;
        }

        // 중복 발송 방지 체크
        if (link.preventDuplicate) {
            const [alreadySent] = await db
                .select({ id: alimtalkSendLogs.id })
                .from(alimtalkSendLogs)
                .where(
                    and(
                        eq(alimtalkSendLogs.recordId, record.id),
                        eq(alimtalkSendLogs.templateLinkId, link.id),
                        inArray(alimtalkSendLogs.status, ["sent", "pending"])
                    )
                )
                .limit(1);
            if (alreadySent) {
                console.log(`[alimtalk] skip link ${link.id} (${link.name}): duplicate prevented`);
                continue;
            }
        }

        // 쿨다운 체크
        const canSend = await checkCooldown(record.id, link.id);
        if (!canSend) {
            console.log(`[alimtalk] skip link ${link.id} (${link.name}): cooldown`);
            continue;
        }

        console.log(`[alimtalk] sending link ${link.id} (${link.name}) to record ${record.id}`);
        // 발송
        const logId = await sendSingle(link, record, orgId, "auto");

        // 후속발송 큐 등록 (다단계: 첫 step만 등록, 다음 step은 발송 후 체인)
        if (logId) {
            const steps = normalizeFollowupConfig(link.followupConfig);
            if (steps.length > 0) {
                await enqueueFollowupStep({
                    parentLogId: logId,
                    templateLinkId: link.id,
                    orgId,
                    baseAt: new Date(),
                    step: steps[0],
                    stepIndex: 0,
                });
            }
        }

        // 반복 발송 큐 등록
        if (logId && link.repeatConfig) {
            const config = link.repeatConfig as {
                intervalHours: number;
                maxRepeat: number;
                stopCondition: { field: string; operator: "eq" | "ne"; value: string };
            };

            const nextRunAt = new Date(Date.now() + config.intervalHours * 60 * 60 * 1000);

            await db.insert(alimtalkAutomationQueue).values({
                templateLinkId: link.id,
                recordId: record.id,
                orgId,
                repeatCount: 0,
                nextRunAt,
                status: "pending",
            });
        }
    }
}

// ============================================
// 반복 큐 처리 (Cron에서 호출)
// ============================================

export async function processRepeatQueue(): Promise<{
    processed: number;
    sent: number;
    completed: number;
    failed: number;
}> {
    const now = new Date();
    const stats = { processed: 0, sent: 0, completed: 0, failed: 0 };

    // pending 상태이고 nextRunAt이 지난 항목 조회
    const items = await db
        .select()
        .from(alimtalkAutomationQueue)
        .where(
            and(
                eq(alimtalkAutomationQueue.status, "pending"),
                lte(alimtalkAutomationQueue.nextRunAt, now)
            )
        )
        .limit(100);

    for (const item of items) {
        stats.processed++;

        // 레코드 조회
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, item.recordId))
            .limit(1);

        if (!record) {
            await db
                .update(alimtalkAutomationQueue)
                .set({ status: "cancelled", updatedAt: now })
                .where(eq(alimtalkAutomationQueue.id, item.id));
            stats.completed++;
            continue;
        }

        // 템플릿 링크 조회
        const [link] = await db
            .select()
            .from(alimtalkTemplateLinks)
            .where(eq(alimtalkTemplateLinks.id, item.templateLinkId))
            .limit(1);

        if (!link || link.isActive !== 1 || !link.repeatConfig) {
            await db
                .update(alimtalkAutomationQueue)
                .set({ status: "cancelled", updatedAt: now })
                .where(eq(alimtalkAutomationQueue.id, item.id));
            stats.completed++;
            continue;
        }

        const config = link.repeatConfig as {
            intervalHours: number;
            maxRepeat: number;
            stopCondition: { field: string; operator: "eq" | "ne"; value: string };
        };

        // 중단 조건 평가
        const data = record.data as Record<string, unknown>;
        if (evaluateCondition(config.stopCondition, data)) {
            await db
                .update(alimtalkAutomationQueue)
                .set({ status: "completed", updatedAt: now })
                .where(eq(alimtalkAutomationQueue.id, item.id));
            stats.completed++;
            continue;
        }

        // 발송
        const success = await sendSingle(link, record, item.orgId, "repeat");

        const newCount = item.repeatCount + 1;
        const isMaxReached = newCount >= config.maxRepeat;

        if (success) {
            stats.sent++;
        } else {
            stats.failed++;
        }

        // 큐 업데이트
        await db
            .update(alimtalkAutomationQueue)
            .set({
                repeatCount: newCount,
                status: isMaxReached ? "completed" : "pending",
                nextRunAt: isMaxReached ? item.nextRunAt : new Date(Date.now() + config.intervalHours * 60 * 60 * 1000),
                updatedAt: now,
            })
            .where(eq(alimtalkAutomationQueue.id, item.id));

        if (isMaxReached) {
            stats.completed++;
        }
    }

    return stats;
}

// ============================================
// 후속발송 큐 처리 (Cron에서 호출)
// ============================================

interface FollowupQueueStats {
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
    skippedAsLocked?: boolean;
}

export async function processAlimtalkFollowupQueue(): Promise<FollowupQueueStats> {
    const stats: FollowupQueueStats = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    // [1] advisory lock 획득 (cron 겹침 방지)
    const lockResult = await db.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_lock(${FOLLOWUP_CRON_LOCK_KEY}) AS acquired`
    );
    const acquired = lockResult[0]?.acquired === true;
    if (!acquired) {
        console.log("[alimtalk-followup] another instance running, skip");
        return { ...stats, skippedAsLocked: true };
    }

    const startTime = Date.now();

    try {
        // [2] 좀비 청소: 10분 이상 processing 상태 → pending 복구
        const zombieCutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
        await db
            .update(alimtalkFollowupQueue)
            .set({ status: "pending" })
            .where(
                and(
                    eq(alimtalkFollowupQueue.status, "processing"),
                    lte(alimtalkFollowupQueue.processedAt, zombieCutoff)
                )
            );

        // [3] atomic 픽업: pending → processing (LIMIT + SKIP LOCKED)
        const items = await db.execute<{
            id: number;
            parent_log_id: number;
            template_link_id: number;
            org_id: string;
            send_at: Date;
            status: string;
            step_index: number;
            processed_at: Date | null;
            created_at: Date;
        }>(sql`
            UPDATE alimtalk_followup_queue
            SET status = 'processing', processed_at = NOW()
            WHERE id IN (
                SELECT id FROM alimtalk_followup_queue
                WHERE status = 'pending' AND send_at <= NOW()
                ORDER BY send_at ASC
                LIMIT ${PICKUP_LIMIT}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING *
        `);
        if (items.length === 0) return stats;

        console.log(`[alimtalk-followup] picked ${items.length} items`);

        // snake_case → camelCase 매핑
        const mappedItems = items.map((row) => ({
            id: row.id,
            parentLogId: row.parent_log_id,
            templateLinkId: row.template_link_id,
            orgId: row.org_id,
            sendAt: row.send_at,
            status: row.status,
            stepIndex: row.step_index ?? 0,
            processedAt: row.processed_at,
            createdAt: row.created_at,
        }));

        // [4] 5건 병렬 + 1초 딜레이 배치 처리
        for (let i = 0; i < mappedItems.length; i += BATCH_SIZE) {
            // 타임아웃 가드 — 남은 항목은 좀비 복구로 다음 cron이 회수
            if (Date.now() - startTime > PROCESS_TIMEOUT_MS) {
                console.warn(
                    `[alimtalk-followup] timeout at ${i}/${mappedItems.length}, deferring rest`
                );
                break;
            }

            const batch = mappedItems.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map((item) => processFollowupItem(item, stats))
            );
            for (const r of results) {
                if (r.status === "rejected") {
                    console.error("[alimtalk-followup] batch error:", r.reason);
                }
            }

            if (i + BATCH_SIZE < mappedItems.length) {
                await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
            }
        }

        return stats;
    } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(${FOLLOWUP_CRON_LOCK_KEY})`);
    }
}

// 단건 처리
async function processFollowupItem(
    item: typeof alimtalkFollowupQueue.$inferSelect,
    stats: FollowupQueueStats
): Promise<void> {
    stats.processed++;

    try {
        // [1] 부모 로그에서 레코드 조회
        const [parentLog] = await db
            .select({ recordId: alimtalkSendLogs.recordId })
            .from(alimtalkSendLogs)
            .where(eq(alimtalkSendLogs.id, item.parentLogId));

        if (!parentLog?.recordId) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [2] 링크 + followupConfig 조회
        const [link] = await db
            .select()
            .from(alimtalkTemplateLinks)
            .where(eq(alimtalkTemplateLinks.id, item.templateLinkId));

        if (!link?.followupConfig) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [3] 다단계: 현재 step 정보 조회
        const steps = normalizeFollowupConfig(link.followupConfig);
        const currentStep = steps[item.stepIndex];
        if (!currentStep) {
            // 사용자가 step 삭제 등으로 설정이 줄어든 경우
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            console.log(`[alimtalk-followup] skip item ${item.id}: step ${item.stepIndex} not found in config`);
            return;
        }

        // [4] 멱등성 체크 (step 단위): 직전 1시간 내 같은 (record, link, step) 발송 이력 있으면 skip
        const targetStepIndex = item.stepIndex + 1; // send_logs는 1부터 (auto=0)
        const idempotencyCutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
        const [recentSent] = await db
            .select({ id: alimtalkSendLogs.id })
            .from(alimtalkSendLogs)
            .where(
                and(
                    eq(alimtalkSendLogs.recordId, parentLog.recordId),
                    eq(alimtalkSendLogs.templateLinkId, link.id),
                    eq(alimtalkSendLogs.triggerType, "followup"),
                    eq(alimtalkSendLogs.stepIndex, targetStepIndex),
                    gte(alimtalkSendLogs.sentAt, idempotencyCutoff),
                    inArray(alimtalkSendLogs.status, ["sent", "pending"])
                )
            )
            .limit(1);

        if (recentSent) {
            await closeQueueItem(item.id, "sent");
            stats.skipped++;
            console.log(`[alimtalk-followup] skip item ${item.id}: step ${item.stepIndex} already sent within window`);
            return;
        }

        // [5] 레코드 조회
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId));

        if (!record) {
            await closeQueueItem(item.id, "failed");
            stats.failed++;
            return;
        }

        // [6] 후속발송용 링크 가공 (현재 step의 templateCode/매핑 사용)
        const followupLink = {
            ...link,
            templateCode: currentStep.templateCode,
            templateName: currentStep.templateName || null,
            variableMappings: currentStep.variableMappings || link.variableMappings,
        };

        // [7] 발송 (send_logs.stepIndex = item.stepIndex + 1)
        const logId = await sendSingle(followupLink, record, item.orgId, "followup", targetStepIndex);
        await closeQueueItem(item.id, logId ? "sent" : "failed");

        if (logId) {
            stats.sent++;

            // [8] 다음 step 체인: 발송 성공 시에만 다음 step 큐 등록
            const nextStepIndex = item.stepIndex + 1;
            const nextStep = steps[nextStepIndex];
            if (nextStep) {
                await enqueueFollowupStep({
                    parentLogId: logId, // 이번 발송 로그가 다음 후속의 부모
                    templateLinkId: link.id,
                    orgId: item.orgId,
                    baseAt: new Date(),
                    step: nextStep,
                    stepIndex: nextStepIndex,
                });
            }
        } else {
            stats.failed++;
            // 발송 실패 시 체인 중단
        }
    } catch (err) {
        console.error(`[alimtalk-followup] item ${item.id} error:`, err);
        await closeQueueItem(item.id, "failed");
        stats.failed++;
    }
}
