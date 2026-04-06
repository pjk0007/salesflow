import { db, emailAutoPersonalizedLinks, emailSendLogs, emailSenderProfiles, emailSignatures, records, products } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { getAiClient, generateEmail, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { evaluateCondition } from "@/lib/alimtalk-automation";
import { resolveDefaultSender, resolveDefaultSignature } from "@/lib/email-sender-resolver";
import { enqueueFollowup } from "@/lib/email-followup";
import type { DbRecord } from "@/lib/db";

// ============================================
// 쿨다운 체크 (같은 record + ai_auto에 1시간 내 발송 이력)
// ============================================
async function checkCooldown(recordId: number, cooldownHours: number = 1): Promise<boolean> {
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.recordId, recordId),
                eq(emailSendLogs.triggerType, "ai_auto"),
                gte(emailSendLogs.sentAt, since),
                inArray(emailSendLogs.status, ["sent", "pending"])
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 중복 수신자 체크 (같은 파티션 + 같은 이메일로 AI 자동 발송 이력)
// ============================================
async function checkDuplicateRecipientForAiAuto(
    partitionId: number,
    recipientEmail: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: emailSendLogs.id })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.partitionId, partitionId),
                eq(emailSendLogs.recipientEmail, recipientEmail),
                eq(emailSendLogs.triggerType, "ai_auto"),
                eq(emailSendLogs.status, "sent")
            )
        )
        .limit(1);
    return !existing;
}

// ============================================
// 메인 자동화 함수
// ============================================
interface AutoPersonalizedParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

export async function processAutoPersonalizedEmail(params: AutoPersonalizedParams): Promise<void> {
    const { record, partitionId, triggerType, orgId } = params;

    console.log(`[AutoEmail] Start: record=${record.id}, partition=${partitionId}, trigger=${triggerType}`);

    // 1. 매칭되는 규칙 조회
    const links = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(
            and(
                eq(emailAutoPersonalizedLinks.partitionId, partitionId),
                eq(emailAutoPersonalizedLinks.triggerType, triggerType),
                eq(emailAutoPersonalizedLinks.isActive, 1)
            )
        );

    if (links.length === 0) { console.log(`[AutoEmail] No matching rules`); return; }
    console.log(`[AutoEmail] Found ${links.length} rules`);

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        try {
            // 2. 조건 평가
            if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
                console.log(`[AutoEmail] Rule ${link.id}: condition not met`);
                continue;
            }

            // 3. 쿨다운 체크
            const canSend = await checkCooldown(record.id);
            if (!canSend) { console.log(`[AutoEmail] Rule ${link.id}: cooldown active`); continue; }

            // 3-1. 중복 수신자 체크
            if (link.preventDuplicate) {
                const recipientEmail = data[link.recipientField] as string;
                if (recipientEmail) {
                    const canSendDup = await checkDuplicateRecipientForAiAuto(link.partitionId, recipientEmail);
                    if (!canSendDup) {
                        console.log(`[AutoEmail] Rule ${link.id}: duplicate recipient skipped: ${recipientEmail}`);
                        continue;
                    }
                }
            }

            // 4. 수신자 이메일 추출
            const email = data[link.recipientField];
            if (!email || typeof email !== "string" || !email.includes("@")) { console.log(`[AutoEmail] Rule ${link.id}: no valid email in field "${link.recipientField}" (got: ${email})`); continue; }

            // 5. AI 클라이언트 확인
            const aiClient = getAiClient();
            if (!aiClient) { console.log(`[AutoEmail] Rule ${link.id}: no AI client (GEMINI_API_KEY missing)`); continue; }

            // 5-1. 토큰 쿼터 확인
            const quota = await checkTokenQuota(orgId);
            if (!quota.allowed) { console.log(`[AutoEmail] Rule ${link.id}: quota exceeded`); continue; }

            // 6. 이메일 클라이언트 확인
            const emailClient = await getEmailClient(orgId);
            if (!emailClient) { console.log(`[AutoEmail] Rule ${link.id}: no email client`); continue; }
            const emailConfig = await getEmailConfig(orgId);

            // 6-1. 발신자 프로필 결정 (규칙 지정 → 기본 프로필 → 레거시 fallback)
            let senderFromEmail: string | null = null;
            let senderFromName: string | undefined;
            if ((link as Record<string, unknown>).senderProfileId) {
                const [profile] = await db.select().from(emailSenderProfiles)
                    .where(and(eq(emailSenderProfiles.id, (link as Record<string, unknown>).senderProfileId as number), eq(emailSenderProfiles.orgId, orgId)))
                    .limit(1);
                if (profile) { senderFromEmail = profile.fromEmail; senderFromName = profile.fromName; }
            }
            if (!senderFromEmail) {
                const sender = await resolveDefaultSender(orgId, emailConfig);
                senderFromEmail = sender.fromEmail;
                senderFromName = sender.fromName;
            }
            if (!senderFromEmail) continue;

            // 6-2. 서명 결정 (규칙 지정 → 기본 서명 → 레거시 fallback)
            let signatureJson: string | null = null;
            if ((link as Record<string, unknown>).signatureId) {
                const [sig] = await db.select().from(emailSignatures)
                    .where(and(eq(emailSignatures.id, (link as Record<string, unknown>).signatureId as number), eq(emailSignatures.orgId, orgId)))
                    .limit(1);
                if (sig) signatureJson = sig.signature;
            }
            if (!signatureJson) {
                signatureJson = await resolveDefaultSignature(orgId, emailConfig);
            }

            // 7. 회사 조사 (autoResearch && _companyResearch 없으면)
            let recordData = { ...data };
            if (link.autoResearch === 1 && !recordData._companyResearch) {
                const companyName = data[link.companyField] as string;
                if (aiClient && companyName && typeof companyName === "string" && companyName.trim()) {
                    const research = await generateCompanyResearch(aiClient, { companyName, additionalContext: data });
                    recordData._companyResearch = {
                        ...research,
                        sources: research.sources,
                        researchedAt: new Date().toISOString(),
                    };

                    // 레코드에 _companyResearch 저장
                    await db
                        .update(records)
                        .set({ data: { ...data, _companyResearch: recordData._companyResearch } })
                        .where(eq(records.id, record.id));

                    const researchTokens = research.usage.promptTokens + research.usage.completionTokens;
                    await updateTokenUsage(orgId, researchTokens);

                    await logAiUsage({
                        orgId,
                        userId: null,
                        provider: "gemini",
                        model: aiClient.model,
                        promptTokens: research.usage.promptTokens,
                        completionTokens: research.usage.completionTokens,
                        purpose: "auto_company_research",
                    });
                }
            }

            // 8. 제품 조회
            let product = null;
            if (link.productId) {
                const [p] = await db
                    .select()
                    .from(products)
                    .where(eq(products.id, link.productId))
                    .limit(1);
                product = p ?? null;
            }

            // 8-1. 발신자 페르소나 (서명에서 추출)
            let senderPersona: { name: string; title?: string; company?: string } | null = null;
            if (link.useSignaturePersona === 1 && signatureJson) {
                try {
                    const sig = JSON.parse(signatureJson);
                    if (sig && typeof sig === "object" && sig.name) {
                        senderPersona = {
                            name: sig.name,
                            title: sig.title || undefined,
                            company: sig.company || undefined,
                        };
                    }
                } catch { /* legacy plain text signature — skip */ }
            }

            // 8-2. AI 이메일 생성
            const prompt = link.prompt || "이 회사에 적합한 제품 소개 이메일을 작성해주세요.";
            const emailResult = await generateEmail(aiClient, {
                prompt,
                product,
                recordData,
                tone: link.tone || undefined,
                ctaUrl: product?.url || undefined,
                format: (link.format as "plain" | "designed") || "plain",
                senderPersona,
            });
            console.log(`[AutoEmail] Email generated for record ${record.id}: subject="${emailResult.subject}"`);

            const emailTokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
            await updateTokenUsage(orgId, emailTokens);

            await logAiUsage({
                orgId,
                userId: null,
                provider: "gemini",
                model: aiClient.model,
                promptTokens: emailResult.usage.promptTokens,
                completionTokens: emailResult.usage.completionTokens,
                purpose: "auto_personalized_email",
            });

            // 9. NHN Cloud 이메일 발송
            let finalBody = emailResult.htmlBody;
            if (signatureJson) {
                finalBody = appendSignature(finalBody, signatureJson);
            }

            const nhnResult = await emailClient.sendEachMail({
                senderAddress: senderFromEmail!,
                senderName: senderFromName,
                title: emailResult.subject,
                body: finalBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
            });

            const sendResult = nhnResult.data?.results?.[0];
            const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

            // 10. 발송 로그 기록
            const [inserted] = await db.insert(emailSendLogs).values({
                orgId,
                partitionId,
                recordId: record.id,
                recipientEmail: email,
                subject: emailResult.subject,
                body: finalBody,
                requestId: nhnResult.data?.requestId,
                status: isSuccess ? "sent" : "failed",
                resultCode: sendResult ? String(sendResult.resultCode) : null,
                resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                triggerType: "ai_auto",
                sentAt: new Date(),
            }).returning({ id: emailSendLogs.id });
            console.log(`[AutoEmail] Rule ${link.id}: ${isSuccess ? "sent" : "failed"} to ${email}`);

            // 11. 후속 발송 큐 등록
            if (isSuccess && inserted?.id && link.followupConfig) {
                const steps = Array.isArray(link.followupConfig) ? link.followupConfig : [link.followupConfig];
                const first = steps[0] as { delayDays: number } | undefined;
                if (first?.delayDays) {
                    await enqueueFollowup({
                        logId: inserted.id,
                        sourceType: "ai",
                        sourceId: link.id,
                        orgId,
                        sentAt: new Date(),
                        delayDays: first.delayDays,
                    });
                }
            }
        } catch (err) {
            console.error(`Auto personalized email error (link ${link.id}, record ${record.id}):`, err);
        }
    }
}
