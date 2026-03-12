import {
    db,
    emailFollowupQueue,
    emailSendLogs,
    emailTemplateLinks,
    emailAutoPersonalizedLinks,
    emailTemplates,
    records,
    products,
} from "@/lib/db";
import { eq, and, lte } from "drizzle-orm";
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature } from "@/lib/nhn-email";
import { getAiClient, generateEmail, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { resolveDefaultSender, resolveDefaultSignature } from "@/lib/email-sender-resolver";

// ============================================
// 타입 정의
// ============================================

interface TemplateFollowupStep {
    delayDays: number;
    onOpened?: { templateId: number };
    onNotOpened?: { templateId: number };
}

interface AiFollowupStep {
    delayDays: number;
    onOpened?: { prompt: string };
    onNotOpened?: { prompt: string };
}

type FollowupConfig = TemplateFollowupStep | AiFollowupStep;

/** followupConfig를 배열로 정규화 (하위 호환) */
function normalizeFollowupConfig(config: unknown): FollowupConfig[] {
    if (!config) return [];
    if (Array.isArray(config)) return config;
    return [config as FollowupConfig];
}

// ============================================
// 후속 발송 큐 등록
// ============================================

export async function enqueueFollowup(params: {
    logId: number;
    sourceType: "template" | "ai";
    sourceId: number;
    orgId: string;
    sentAt: Date;
    delayDays: number;
    stepIndex?: number;
}): Promise<void> {
    const stepIndex = params.stepIndex ?? 0;
    const checkAt = new Date(params.sentAt.getTime() + params.delayDays * 24 * 60 * 60 * 1000);

    await db
        .insert(emailFollowupQueue)
        .values({
            parentLogId: params.logId,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            orgId: params.orgId,
            stepIndex,
            checkAt,
            status: "pending",
        })
        .onConflictDoNothing();
}

// ============================================
// 후속 큐 처리 (크론에서 호출)
// ============================================

export async function processEmailFollowupQueue(): Promise<{
    processed: number;
    sent: number;
    skipped: number;
    cancelled: number;
}> {
    const now = new Date();
    const stats = { processed: 0, sent: 0, skipped: 0, cancelled: 0 };

    const items = await db
        .select()
        .from(emailFollowupQueue)
        .where(
            and(
                eq(emailFollowupQueue.status, "pending"),
                lte(emailFollowupQueue.checkAt, now)
            )
        )
        .limit(100);

    for (const item of items) {
        stats.processed++;

        try {
            // 1. 원본 발송 로그 조회
            const [parentLog] = await db
                .select()
                .from(emailSendLogs)
                .where(eq(emailSendLogs.id, item.parentLogId))
                .limit(1);

            if (!parentLog) {
                await updateQueueStatus(item.id, "cancelled", null);
                stats.cancelled++;
                continue;
            }

            // 2. 읽음 상태 최신화 (NHN API)
            await syncReadStatus(parentLog);

            // 재조회 (업데이트 반영)
            const [refreshedLog] = await db
                .select()
                .from(emailSendLogs)
                .where(eq(emailSendLogs.id, item.parentLogId))
                .limit(1);

            const isOpened = refreshedLog?.isOpened === 1;
            const result = isOpened ? "opened" : "not_opened";

            // 3. sourceType에 따라 분기
            let sent = false;

            if (item.sourceType === "template") {
                sent = await handleTemplateFollowup(item, refreshedLog!, isOpened);
            } else if (item.sourceType === "ai") {
                sent = await handleAiFollowup(item, refreshedLog!, isOpened);
            }

            if (sent) {
                await updateQueueStatus(item.id, "sent", result);
                stats.sent++;
            } else {
                await updateQueueStatus(item.id, "skipped", result);
                stats.skipped++;
            }
        } catch (err) {
            console.error(`[Followup] Error processing queue item ${item.id}:`, err);
            await updateQueueStatus(item.id, "cancelled", null);
            stats.cancelled++;
        }
    }

    return stats;
}

// ============================================
// 내부 헬퍼: 큐 상태 업데이트
// ============================================

async function updateQueueStatus(
    queueId: number,
    status: string,
    result: string | null
) {
    await db
        .update(emailFollowupQueue)
        .set({ status, result, processedAt: new Date() })
        .where(eq(emailFollowupQueue.id, queueId));
}

// ============================================
// 내부 헬퍼: 읽음 상태 최신화
// ============================================

async function syncReadStatus(log: typeof emailSendLogs.$inferSelect) {
    if (!log.requestId || log.isOpened === 1) return;

    try {
        const client = await getEmailClient(log.orgId);
        if (!client) return;

        const result = await client.queryMails({ requestId: log.requestId });
        if (!result.header.isSuccessful || !result.data) return;

        for (const mail of result.data) {
            if (mail.receiveMailAddr === log.recipientEmail && mail.isOpened) {
                await db
                    .update(emailSendLogs)
                    .set({
                        isOpened: 1,
                        openedAt: mail.openedDate ? new Date(mail.openedDate) : new Date(),
                    })
                    .where(eq(emailSendLogs.id, log.id));
                break;
            }
        }
    } catch {
        // NHN API 실패 시 기존 상태 유지
    }
}

// ============================================
// 템플릿 기반 후속 발송
// ============================================

async function handleTemplateFollowup(
    item: typeof emailFollowupQueue.$inferSelect,
    parentLog: typeof emailSendLogs.$inferSelect,
    isOpened: boolean
): Promise<boolean> {
    // 1. templateLink 조회
    const [link] = await db
        .select()
        .from(emailTemplateLinks)
        .where(eq(emailTemplateLinks.id, item.sourceId))
        .limit(1);

    if (!link || !link.followupConfig) return false;

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[item.stepIndex] as TemplateFollowupStep | undefined;
    if (!currentStep) return false;

    // 2. 조건에 맞는 templateId 확인
    const action = isOpened ? currentStep.onOpened : currentStep.onNotOpened;
    if (!action?.templateId) return false;

    // 3. 후속 템플릿 조회
    const [template] = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.id, action.templateId))
        .limit(1);

    if (!template) return false;

    // 4. 발신자 + 서명 결정
    const emailConfig = await getEmailConfig(item.orgId);
    const sender = await resolveDefaultSender(item.orgId, emailConfig);
    if (!sender.fromEmail) return false;
    const signatureJson = await resolveDefaultSignature(item.orgId, emailConfig);

    // 5. 원본 레코드 조회 (변수 치환용)
    let data: Record<string, unknown> = {};
    if (parentLog.recordId) {
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId))
            .limit(1);
        if (record) data = record.data as Record<string, unknown>;
    }

    // 6. 변수 치환 + 서명
    const mappings = (link.variableMappings as Record<string, string>) || {};
    const subject = substituteVariables(template.subject, mappings, data);
    let body = substituteVariables(template.htmlBody, mappings, data);
    if (signatureJson) {
        body = appendSignature(body, signatureJson);
    }

    // 7. NHN 발송
    const client = await getEmailClient(item.orgId);
    if (!client) return false;

    const nhnResult = await client.sendEachMail({
        senderAddress: sender.fromEmail,
        senderName: sender.fromName,
        title: subject,
        body,
        receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
    });

    const sendResult = nhnResult.data?.results?.[0];
    const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

    // 8. 로그 기록
    const [inserted] = await db.insert(emailSendLogs).values({
        orgId: item.orgId,
        templateLinkId: link.id,
        partitionId: link.partitionId,
        recordId: parentLog.recordId,
        emailTemplateId: template.id,
        recipientEmail: parentLog.recipientEmail,
        subject,
        body,
        requestId: nhnResult.data?.requestId,
        status: isSuccess ? "sent" : "failed",
        resultCode: sendResult ? String(sendResult.resultCode) : null,
        resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        triggerType: "followup",
        parentLogId: parentLog.id,
        sentAt: new Date(),
    }).returning({ id: emailSendLogs.id });

    // 9. 체인: 다음 step이 있으면 큐 등록
    if (isSuccess && inserted?.id) {
        const nextStep = steps[item.stepIndex + 1] as TemplateFollowupStep | undefined;
        if (nextStep) {
            await enqueueFollowup({
                logId: inserted.id,
                sourceType: "template",
                sourceId: link.id,
                orgId: item.orgId,
                sentAt: new Date(),
                delayDays: nextStep.delayDays,
                stepIndex: item.stepIndex + 1,
            });
        }
    }

    return isSuccess;
}

// ============================================
// AI 기반 후속 발송
// ============================================

async function handleAiFollowup(
    item: typeof emailFollowupQueue.$inferSelect,
    parentLog: typeof emailSendLogs.$inferSelect,
    isOpened: boolean
): Promise<boolean> {
    // 1. autoPersonalizedLink 조회
    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(eq(emailAutoPersonalizedLinks.id, item.sourceId))
        .limit(1);

    if (!link || !link.followupConfig) return false;

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[item.stepIndex] as AiFollowupStep | undefined;
    if (!currentStep) return false;

    // 2. 조건에 맞는 prompt 확인
    const action = isOpened ? currentStep.onOpened : currentStep.onNotOpened;
    if (!action?.prompt) return false;

    // 3. AI 클라이언트 확인
    const aiClient = getAiClient();
    if (!aiClient) return false;

    const quota = await checkTokenQuota(item.orgId);
    if (!quota.allowed) return false;

    // 4. 발신자 + 서명 결정
    const emailConfig = await getEmailConfig(item.orgId);
    const sender = await resolveDefaultSender(item.orgId, emailConfig);
    if (!sender.fromEmail) return false;
    const signatureJson = await resolveDefaultSignature(item.orgId, emailConfig);

    // 5. 원본 레코드 + 제품 조회
    let recordData: Record<string, unknown> = {};
    if (parentLog.recordId) {
        const [record] = await db
            .select()
            .from(records)
            .where(eq(records.id, parentLog.recordId))
            .limit(1);
        if (record) recordData = record.data as Record<string, unknown>;
    }

    let product = null;
    if (link.productId) {
        const [p] = await db.select().from(products).where(eq(products.id, link.productId)).limit(1);
        product = p ?? null;
    }

    // 6. AI 프롬프트 구성 (이전 이메일 컨텍스트 포함)
    const previousEmailContext = [
        `이전에 발송한 이메일:`,
        `- 제목: ${parentLog.subject || "(없음)"}`,
        `- 본문 요약: ${(parentLog.body || "").substring(0, 500)}`,
        `- 읽음 여부: ${isOpened ? "읽음" : "읽지 않음"}`,
        `- 후속 단계: ${item.stepIndex + 1}단계`,
        ``,
        `위 이메일에 대한 후속 이메일을 작성해주세요.`,
        `사용자 지시: ${action.prompt}`,
    ].join("\n");

    // 7. 발신자 페르소나
    let senderPersona: { name: string; title?: string; company?: string } | null = null;
    if (link.useSignaturePersona === 1 && signatureJson) {
        try {
            const sig = JSON.parse(signatureJson);
            if (sig && typeof sig === "object" && sig.name) {
                senderPersona = { name: sig.name, title: sig.title || undefined, company: sig.company || undefined };
            }
        } catch { /* skip */ }
    }

    // 8. AI 이메일 생성
    const emailResult = await generateEmail(aiClient, {
        prompt: previousEmailContext,
        product,
        recordData,
        tone: link.tone || undefined,
        format: (link.format as "plain" | "designed") || "plain",
        senderPersona,
    });

    const emailTokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
    await updateTokenUsage(item.orgId, emailTokens);
    await logAiUsage({
        orgId: item.orgId,
        userId: null,
        provider: "gemini",
        model: aiClient.model,
        promptTokens: emailResult.usage.promptTokens,
        completionTokens: emailResult.usage.completionTokens,
        purpose: "followup_email",
    });

    // 9. NHN 발송
    let finalBody = emailResult.htmlBody;
    if (signatureJson) {
        finalBody = appendSignature(finalBody, signatureJson);
    }

    const emailClient = await getEmailClient(item.orgId);
    if (!emailClient) return false;

    const nhnResult = await emailClient.sendEachMail({
        senderAddress: sender.fromEmail,
        senderName: sender.fromName,
        title: emailResult.subject,
        body: finalBody,
        receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
    });

    const sendResult = nhnResult.data?.results?.[0];
    const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

    // 10. 로그 기록
    const [inserted] = await db.insert(emailSendLogs).values({
        orgId: item.orgId,
        partitionId: parentLog.partitionId,
        recordId: parentLog.recordId,
        recipientEmail: parentLog.recipientEmail,
        subject: emailResult.subject,
        body: finalBody,
        requestId: nhnResult.data?.requestId,
        status: isSuccess ? "sent" : "failed",
        resultCode: sendResult ? String(sendResult.resultCode) : null,
        resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        triggerType: "ai_followup",
        parentLogId: parentLog.id,
        sentAt: new Date(),
    }).returning({ id: emailSendLogs.id });

    // 11. 체인: 다음 step이 있으면 큐 등록
    if (isSuccess && inserted?.id) {
        const nextStep = steps[item.stepIndex + 1] as AiFollowupStep | undefined;
        if (nextStep) {
            await enqueueFollowup({
                logId: inserted.id,
                sourceType: "ai",
                sourceId: link.id,
                orgId: item.orgId,
                sentAt: new Date(),
                delayDays: nextStep.delayDays,
                stepIndex: item.stepIndex + 1,
            });
        }
    }

    return isSuccess;
}
