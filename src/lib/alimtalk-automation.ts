import { db, alimtalkTemplateLinks, alimtalkSendLogs, alimtalkAutomationQueue, records } from "@/lib/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";
import type { DbRecord, AlimtalkTemplateLink } from "@/lib/db";

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
    triggerType: "auto" | "repeat"
): Promise<boolean> {
    const client = await getAlimtalkClient(orgId);
    if (!client) return false;

    const data = record.data as Record<string, unknown>;
    const phone = data[link.recipientField];
    if (!phone || typeof phone !== "string") return false;

    const recipientNo = normalizePhoneNumber(phone);
    if (recipientNo.length < 10) return false;

    // 변수 매핑
    let templateParameter: Record<string, string> | undefined;
    const mappings = link.variableMappings as Record<string, string> | null;
    if (mappings && Object.keys(mappings).length > 0) {
        templateParameter = {};
        for (const [variable, fieldKey] of Object.entries(mappings)) {
            const paramKey = variable.replace(/^#\{|\}$/g, "");
            const fieldValue = data[fieldKey];
            templateParameter[paramKey] = fieldValue != null ? String(fieldValue) : "";
        }
    }

    const nhnResult = await client.sendMessages({
        senderKey: link.senderKey,
        templateCode: link.templateCode,
        recipientList: [{ recipientNo, templateParameter }],
    });

    const isSuccess = nhnResult.header.isSuccessful;
    const sendResult = nhnResult.message?.sendResults?.[0];

    await db.insert(alimtalkSendLogs).values({
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
        triggerType,
        sentAt: new Date(),
    });

    return isSuccess;
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

    if (links.length === 0) return;

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        // 조건 평가
        if (!evaluateCondition(link.triggerCondition as TriggerCondition | null, data)) {
            continue;
        }

        // 쿨다운 체크
        const canSend = await checkCooldown(record.id, link.id);
        if (!canSend) continue;

        // 발송
        const success = await sendSingle(link, record, orgId, "auto");

        // 반복 발송 큐 등록
        if (success && link.repeatConfig) {
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
