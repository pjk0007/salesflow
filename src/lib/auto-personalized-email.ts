import { db, emailAutoPersonalizedLinks, emailSendLogs, records, products } from "@/lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { getAiClient, generateEmail, generateCompanyResearch, logAiUsage } from "@/lib/ai";
import { evaluateCondition } from "@/lib/alimtalk-automation";
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

    if (links.length === 0) return;

    const data = record.data as Record<string, unknown>;

    for (const link of links) {
        try {
            // 2. 조건 평가
            if (!evaluateCondition(link.triggerCondition as Parameters<typeof evaluateCondition>[0], data)) {
                continue;
            }

            // 3. 쿨다운 체크
            const canSend = await checkCooldown(record.id);
            if (!canSend) continue;

            // 4. 수신자 이메일 추출
            const email = data[link.recipientField];
            if (!email || typeof email !== "string" || !email.includes("@")) continue;

            // 5. AI 클라이언트 확인
            const aiClient = await getAiClient(orgId);
            if (!aiClient) continue;

            // 6. 이메일 클라이언트 확인
            const emailClient = await getEmailClient(orgId);
            if (!emailClient) continue;
            const emailConfig = await getEmailConfig(orgId);
            if (!emailConfig?.fromEmail) continue;

            // 7. 회사 조사 (autoResearch && _companyResearch 없으면)
            let recordData = { ...data };
            if (link.autoResearch === 1 && !recordData._companyResearch) {
                const companyName = data[link.companyField] as string;
                if (companyName && typeof companyName === "string" && companyName.trim()) {
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

                    await logAiUsage({
                        orgId,
                        userId: null,
                        provider: aiClient.provider,
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

            // 9. AI 이메일 생성
            console.log(`[AutoEmail] Step 9: Generating email for record ${record.id}, provider: ${aiClient.provider}`);
            const prompt = link.prompt || "이 회사에 적합한 제품 소개 이메일을 작성해주세요.";
            const emailResult = await generateEmail(aiClient, {
                prompt,
                product,
                recordData,
                tone: link.tone || undefined,
                ctaUrl: product?.url || undefined,
            });
            console.log(`[AutoEmail] Step 9 done: subject="${emailResult.subject}", bodyLen=${emailResult.htmlBody?.length ?? 0}`);

            await logAiUsage({
                orgId,
                userId: null,
                provider: aiClient.provider,
                model: aiClient.model,
                promptTokens: emailResult.usage.promptTokens,
                completionTokens: emailResult.usage.completionTokens,
                purpose: "auto_personalized_email",
            });

            // 10. NHN Cloud 이메일 발송
            let finalBody = emailResult.htmlBody;
            if (emailConfig.signatureEnabled && emailConfig.signature) {
                finalBody = appendSignature(finalBody, emailConfig.signature);
            }
            console.log(`[AutoEmail] Step 10: Sending to ${email}, subject="${emailResult.subject}", bodyLen=${finalBody?.length ?? 0}`);

            const nhnResult = await emailClient.sendEachMail({
                senderAddress: emailConfig.fromEmail,
                senderName: emailConfig.fromName || undefined,
                title: emailResult.subject,
                body: finalBody,
                receiverList: [{ receiveMailAddr: email, receiveType: "MRT0" }],
            });
            console.log(`[AutoEmail] Step 10 done: isSuccessful=${nhnResult.header.isSuccessful}, resultMessage=${nhnResult.header.resultMessage}`);

            const isSuccess = nhnResult.header.isSuccessful;
            const sendResult = nhnResult.data?.results?.[0];

            // 11. 발송 로그 기록
            await db.insert(emailSendLogs).values({
                orgId,
                partitionId,
                recordId: record.id,
                recipientEmail: email,
                subject: emailResult.subject,
                requestId: nhnResult.data?.requestId,
                status: isSuccess ? "sent" : "failed",
                resultCode: sendResult ? String(sendResult.resultCode) : null,
                resultMessage: sendResult?.resultMessage ?? nhnResult.header.resultMessage,
                triggerType: "ai_auto",
                sentAt: new Date(),
            });
        } catch (err) {
            console.error(`Auto personalized email error (link ${link.id}, record ${record.id}):`, err);
        }
    }
}
