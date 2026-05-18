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
import { getEmailClient, getEmailConfig, substituteVariables, appendSignature, parseNhnDate } from "@/lib/nhn-email";
import { getAiClient, generateEmail, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { resolveDefaultSender, resolveDefaultSignature } from "@/lib/email-sender-resolver";
import { wrapTrackingUrls } from "@/lib/email-click-tracking";
import { substitutePromptVariables } from "@/lib/email-utils";

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
// AI 후속 메일 생성 (테스트/미리보기용)
// ============================================

export interface GenerateAiFollowupPreviewInput {
    linkId: number;
    parentLogId: number;
    stepIndex: number; // 0-based
    isOpened: boolean;
}

export async function generateAiFollowupPreview(
    input: GenerateAiFollowupPreviewInput,
    orgId: string
): Promise<
    | { success: true; subject: string; htmlBody: string }
    | { success: false; error: string }
> {
    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.id, input.linkId),
                eq(emailAutoPersonalizedLinks.orgId, orgId)
            )
        )
        .limit(1);

    if (!link) return { success: false, error: "규칙을 찾을 수 없습니다." };
    if (!link.followupConfig) return { success: false, error: "후속 발송 설정이 없습니다." };

    const steps = normalizeFollowupConfig(link.followupConfig);
    const currentStep = steps[input.stepIndex] as AiFollowupStep | undefined;
    if (!currentStep) return { success: false, error: "해당 후속 단계가 없습니다." };

    const action = input.isOpened ? currentStep.onOpened : currentStep.onNotOpened;
    if (!action?.prompt) {
        return {
            success: false,
            error: `이 단계의 ${input.isOpened ? "읽음" : "안읽음"} 분기에 프롬프트가 설정되어 있지 않습니다.`,
        };
    }

    const [parentLog] = await db
        .select()
        .from(emailSendLogs)
        .where(and(eq(emailSendLogs.id, input.parentLogId), eq(emailSendLogs.orgId, orgId)))
        .limit(1);
    if (!parentLog) return { success: false, error: "이전 발송 로그를 찾을 수 없습니다." };

    const aiClient = getAiClient();
    if (!aiClient) return { success: false, error: "AI 클라이언트가 구성되지 않았습니다." };

    const quota = await checkTokenQuota(orgId);
    if (!quota.allowed) return { success: false, error: "AI 토큰 한도를 초과했습니다." };

    const emailConfig = await getEmailConfig(orgId);
    const signatureJson = await resolveDefaultSignature(orgId, emailConfig);

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

    const followupPrompt = substitutePromptVariables(action.prompt, recordData);
    const previousEmailContext = [
        `[최우선 지시사항]`,
        `${followupPrompt}`,
        ``,
        `[참고: 이전 발송 이메일]`,
        `- 제목: ${parentLog.subject || "(없음)"}`,
        `- 본문 요약: ${(parentLog.body || "").substring(0, 300)}`,
        `- 읽음 여부: ${input.isOpened ? "읽음" : "읽지 않음"}`,
        `- 후속 단계: ${input.stepIndex + 1}단계`,
        ``,
        `위 지시사항을 반드시 따르되, 이전 이메일은 맥락 파악용으로만 참고하세요. 이전 이메일의 내용을 반복하지 마세요.`,
    ].join("\n");

    let senderPersona: { name: string; title?: string; company?: string } | null = null;
    if (link.useSignaturePersona === 1 && signatureJson) {
        try {
            const sig = JSON.parse(signatureJson);
            if (sig && typeof sig === "object" && sig.name) {
                senderPersona = { name: sig.name, title: sig.title || undefined, company: sig.company || undefined };
            }
        } catch { /* skip */ }
    }

    const emailResult = await generateEmail(aiClient, {
        prompt: previousEmailContext,
        product,
        recordData,
        tone: link.tone || undefined,
        ctaUrl: link.ctaUrl || product?.url || undefined,
        format: (link.format as "plain" | "designed") || "plain",
        senderPersona,
    });

    const tokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
    await updateTokenUsage(orgId, tokens);
    await logAiUsage({
        orgId,
        userId: null,
        provider: "gemini",
        model: aiClient.model,
        promptTokens: emailResult.usage.promptTokens,
        completionTokens: emailResult.usage.completionTokens,
        purpose: "followup_email_test",
    });

    let finalBody = emailResult.htmlBody;
    if (signatureJson) {
        finalBody = appendSignature(finalBody, signatureJson);
    }

    return { success: true, subject: emailResult.subject, htmlBody: finalBody };
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
        .limit(5000);

    // 5건/배치, 1초 딜레이로 배치 병렬 처리
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(item => processFollowupItem(item, stats))
        );
        for (const r of results) {
            if (r.status === "rejected") {
                console.error("[Followup] Batch item error:", r.reason);
            }
        }
        if (i + BATCH_SIZE < items.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    return stats;
}

/** 개별 후속 큐 항목 처리 */
async function processFollowupItem(
    item: typeof emailFollowupQueue.$inferSelect,
    stats: { processed: number; sent: number; skipped: number; cancelled: number }
): Promise<void> {
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
            return;
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
                        openedAt: parseNhnDate(mail.openedDate) ?? new Date(),
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

    // 8. 로그 먼저 insert → 트래킹 URL → 발송 → status 업데이트
    const [inserted] = await db.insert(emailSendLogs).values({
        orgId: item.orgId,
        templateLinkId: link.id,
        partitionId: link.partitionId,
        recordId: parentLog.recordId,
        emailTemplateId: template.id,
        recipientEmail: parentLog.recipientEmail,
        subject,
        body,
        status: "pending",
        triggerType: "followup",
        parentLogId: parentLog.id,
        sentAt: new Date(),
    }).returning({ id: emailSendLogs.id });

    const trackedBody = wrapTrackingUrls(body, inserted.id);

    const nhnResult = await client.sendEachMail({
        senderAddress: sender.fromEmail,
        senderName: sender.fromName,
        title: subject,
        body: trackedBody,
        receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
    });

    const sendResult = nhnResult.data?.results?.[0];
    const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

    await db.update(emailSendLogs)
        .set({
            requestId: nhnResult.data?.requestId,
            status: isSuccess ? "sent" : "failed",
            resultCode: sendResult ? String(sendResult.resultCode) : null,
            resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        })
        .where(eq(emailSendLogs.id, inserted.id));

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

    // 6. AI 프롬프트 구성 (사용자 지시 우선, 이전 이메일 컨텍스트 참고용)
    // 후속 발송 프롬프트의 ##필드명## 변수도 레코드 값으로 치환
    const followupPrompt = substitutePromptVariables(action.prompt, recordData);
    const previousEmailContext = [
        `[최우선 지시사항]`,
        `${followupPrompt}`,
        ``,
        `[참고: 이전 발송 이메일]`,
        `- 제목: ${parentLog.subject || "(없음)"}`,
        `- 본문 요약: ${(parentLog.body || "").substring(0, 300)}`,
        `- 읽음 여부: ${isOpened ? "읽음" : "읽지 않음"}`,
        `- 후속 단계: ${item.stepIndex + 1}단계`,
        ``,
        `위 지시사항을 반드시 따르되, 이전 이메일은 맥락 파악용으로만 참고하세요. 이전 이메일의 내용을 반복하지 마세요.`,
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
        ctaUrl: link.ctaUrl || product?.url || undefined,
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

    // 10. 로그 먼저 insert → 트래킹 URL → 발송 → status 업데이트
    const [inserted] = await db.insert(emailSendLogs).values({
        orgId: item.orgId,
        partitionId: parentLog.partitionId,
        recordId: parentLog.recordId,
        recipientEmail: parentLog.recipientEmail,
        subject: emailResult.subject,
        body: finalBody,
        status: "pending",
        triggerType: "ai_followup",
        parentLogId: parentLog.id,
        sentAt: new Date(),
    }).returning({ id: emailSendLogs.id });

    const trackedBody = wrapTrackingUrls(finalBody, inserted.id);

    const nhnResult = await emailClient.sendEachMail({
        senderAddress: sender.fromEmail,
        senderName: sender.fromName,
        title: emailResult.subject,
        body: trackedBody,
        receiverList: [{ receiveMailAddr: parentLog.recipientEmail, receiveType: "MRT0" }],
    });

    const sendResult = nhnResult.data?.results?.[0];
    const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

    await db.update(emailSendLogs)
        .set({
            requestId: nhnResult.data?.requestId,
            status: isSuccess ? "sent" : "failed",
            resultCode: sendResult ? String(sendResult.resultCode) : null,
            resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
        })
        .where(eq(emailSendLogs.id, inserted.id));

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
