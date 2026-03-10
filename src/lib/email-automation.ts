import { db, emailTemplateLinks, emailSendLogs, emailAutomationQueue, emailTemplates, records } from "@/lib/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import { resolveDefaultSender, resolveDefaultSignature } from "@/lib/email-sender-resolver";
import { enqueueFollowup } from "@/lib/email-followup";
import type { DbRecord, EmailTemplateLink } from "@/lib/db";

// ============================================
// 쿨다운 체크 (중복 발송 방지)
// ============================================

async function checkEmailCooldown(
    recordId: number,
    templateLinkId: number,
    cooldownHours: number = 1
): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.recordId, recordId),
                eq(emailSendLogs.templateLinkId, templateLinkId),
                gte(emailSendLogs.sentAt, since),
                inArray(emailSendLogs.status, ["sent", "pending"])
            )
        )
        .limit(1);

    return !existing;
}

// ============================================
// 단건 자동 발송
// ============================================

async function sendEmailSingle(
    link: EmailTemplateLink,
    record: DbRecord,
    orgId: string,
    triggerType: "auto" | "repeat"
): Promise<{ success: boolean; logId?: number }> {
    const client = await getEmailClient(orgId);
    if (!client) return { success: false };

    const config = await getEmailConfig(orgId);

    // 발신자 프로필 결정 (기본 프로필 → 레거시 fallback)
    const sender = await resolveDefaultSender(orgId, config);
    if (!sender.fromEmail) return { success: false };
    const senderFromEmail = sender.fromEmail;
    const senderFromName = sender.fromName;

    // 서명 결정 (기본 서명 → 레거시 fallback)
    const signatureJson = await resolveDefaultSignature(orgId, config);

    // 이메일 템플릿 조회
    const [template] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.id, link.emailTemplateId))
        .limit(1);

    if (!template) return { success: false };

    const data = record.data as Record<string, unknown>;
    const email = data[link.recipientField];
    if (!email || typeof email !== "string" || !email.includes("@")) return { success: false };

    // 변수 매핑
    const mappings = (link.variableMappings as Record<string, string>) || {};
    const substitutedSubject = substituteVariables(template.subject, mappings, data);
    let finalBody = substituteVariables(template.htmlBody, mappings, data);
    if (signatureJson) {
        finalBody = appendSignature(finalBody, signatureJson);
    }

    const nhnResult = await client.sendEachMail({
        senderAddress: senderFromEmail,
        senderName: senderFromName,
        title: substitutedSubject,
        body: finalBody,
        receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
    });

    const isSuccess = nhnResult.header.isSuccessful;
    const sendResult = nhnResult.data?.results?.[0];

    const [inserted] = await db.insert(emailSendLogs).values({
        orgId,
        templateLinkId: link.id,
        partitionId: link.partitionId,
        recordId: record.id,
        emailTemplateId: template.id,
        recipientEmail: email,
        subject: substitutedSubject,
        body: finalBody,
        requestId: nhnResult.data?.requestId,
        status: isSuccess ? "sent" : "failed",
        resultCode: sendResult ? String(sendResult.resultCode) : null,
        resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        triggerType,
        sentAt: new Date(),
    }).returning({ id: emailSendLogs.id });

    return { success: isSuccess, logId: inserted?.id };
}

// ============================================
// 자동 트리거 처리 (레코드 생성/수정 후 호출)
// ============================================

interface EmailAutoTriggerParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processEmailAutoTrigger(params: EmailAutoTriggerParams): Promise<void> {
    const { record, partitionId, triggerType, orgId } = params;

    const links = await db
        .select()
        .from(emailTemplateLinks)
        .where(
            and(
                eq(emailTemplateLinks.partitionId, partitionId),
                eq(emailTemplateLinks.triggerType, triggerType),
                eq(emailTemplateLinks.isActive, 1)
            )
        );

    if (links.length === 0) return;

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        // 조건 평가
        if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
            continue;
        }

        // 쿨다운 체크
        const canSend = await checkEmailCooldown(record.id, link.id);
        if (!canSend) continue;

        // 발송
        const { success, logId } = await sendEmailSingle(link, record, orgId, "auto");

        // 후속 발송 큐 등록
        if (success && logId && link.followupConfig) {
            const fc = link.followupConfig as { delayDays: number };
            await enqueueFollowup({
                logId,
                sourceType: "template",
                sourceId: link.id,
                orgId,
                sentAt: new Date(),
                delayDays: fc.delayDays,
            });
        }

        // 반복 발송 큐 등록
        if (success && link.repeatConfig) {
            const config = link.repeatConfig as {
                intervalHours: number;
                maxRepeat: number;
                stopCondition: { field: string; operator: "eq" | "ne"; value: string };
            };

            const nextRunAt = new Date(Date.now() + config.intervalHours * 60 * 60 * 1000);

            await db.insert(emailAutomationQueue).values({
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

export async function processEmailRepeatQueue(): Promise<{
    processed: number;
    sent: number;
    completed: number;
    failed: number;
}> {
    const now = new Date();
    const stats = { processed: 0, sent: 0, completed: 0, failed: 0 };

    const items = await db
        .select()
        .from(emailAutomationQueue)
        .where(
            and(
                eq(emailAutomationQueue.status, "pending"),
                lte(emailAutomationQueue.nextRunAt, now)
            )
        )
        .limit(100);

    for (const item of items) {
        stats.processed++;

        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, item.recordId))
            .limit(1);

        if (!record) {
            await db
                .update(emailAutomationQueue)
                .set({ status: "cancelled", updatedAt: now })
                .where(eq(emailAutomationQueue.id, item.id));
            stats.completed++;
            continue;
        }

        const [link] = await db
            .select()
            .from(emailTemplateLinks)
            .where(eq(emailTemplateLinks.id, item.templateLinkId))
            .limit(1);

        if (!link || link.isActive !== 1 || !link.repeatConfig) {
            await db
                .update(emailAutomationQueue)
                .set({ status: "cancelled", updatedAt: now })
                .where(eq(emailAutomationQueue.id, item.id));
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
                .update(emailAutomationQueue)
                .set({ status: "completed", updatedAt: now })
                .where(eq(emailAutomationQueue.id, item.id));
            stats.completed++;
            continue;
        }

        // 발송
        const { success } = await sendEmailSingle(link, record, item.orgId, "repeat");

        const newCount = item.repeatCount + 1;
        const isMaxReached = newCount >= config.maxRepeat;

        if (success) stats.sent++;
        else stats.failed++;

        await db
            .update(emailAutomationQueue)
            .set({
                repeatCount: newCount,
                status: isMaxReached ? "completed" : "pending",
                nextRunAt: isMaxReached ? item.nextRunAt : new Date(Date.now() + config.intervalHours * 60 * 60 * 1000),
                updatedAt: now,
            })
            .where(eq(emailAutomationQueue.id, item.id));

        if (isMaxReached) stats.completed++;
    }

    return stats;
}
