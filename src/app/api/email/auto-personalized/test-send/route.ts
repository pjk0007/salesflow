import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, products, records } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { getAiClient, generateEmail, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { resolveDefaultSender, resolveDefaultSignature } from "@/lib/email-sender-resolver";

// POST /api/email/auto-personalized/test-send
// body: { linkId: number, testEmail: string, recordId?: number }
export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { linkId, testEmail, testData: inputTestData, recordId } = await req.json();

        if (!linkId || !testEmail) {
            return NextResponse.json({ success: false, error: "linkId와 testEmail은 필수입니다." }, { status: 400 });
        }

        // 1. 규칙 조회
        const [link] = await db
            .select()
            .from(emailAutoPersonalizedLinks)
            .where(eq(emailAutoPersonalizedLinks.id, linkId))
            .limit(1);

        if (!link || link.orgId !== user.orgId) {
            return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
        }

        // 2. 레코드 데이터 (testData > recordId > 더미)
        let recordData: Record<string, unknown> = {};
        if (inputTestData && typeof inputTestData === "object") {
            recordData = { ...inputTestData };
        } else if (recordId) {
            const [record] = await db
                .select()
                .from(records)
                .where(eq(records.id, recordId))
                .limit(1);
            if (record) {
                recordData = (record.data ?? {}) as Record<string, unknown>;
            }
        }

        // 필수 필드 보완
        if (!recordData[link.recipientField]) {
            recordData[link.recipientField] = testEmail;
        }
        if (!recordData[link.companyField]) {
            recordData[link.companyField] = "테스트 회사";
        }

        // 3. AI 클라이언트
        const aiClient = getAiClient();
        if (!aiClient) {
            return NextResponse.json({ success: false, error: "AI API 키가 설정되지 않았습니다." }, { status: 400 });
        }

        const quota = await checkTokenQuota(user.orgId);
        if (!quota.allowed) {
            return NextResponse.json({ success: false, error: "AI 토큰 쿼터를 초과했습니다." }, { status: 429 });
        }

        // 4. 이메일 클라이언트
        const emailClient = await getEmailClient(user.orgId);
        if (!emailClient) {
            return NextResponse.json({ success: false, error: "이메일 API가 설정되지 않았습니다." }, { status: 400 });
        }
        const emailConfig = await getEmailConfig(user.orgId);

        const sender = await resolveDefaultSender(user.orgId, emailConfig);
        if (!sender.fromEmail) {
            return NextResponse.json({ success: false, error: "발신자 프로필이 설정되지 않았습니다." }, { status: 400 });
        }

        const signatureJson = await resolveDefaultSignature(user.orgId, emailConfig);

        // 5. 회사 조사 (autoResearch ON && 레코드에 _companyResearch 없으면)
        if (link.autoResearch === 1 && !recordData._companyResearch) {
            const companyName = recordData[link.companyField] as string;
            if (companyName && typeof companyName === "string" && companyName.trim()) {
                try {
                    const research = await generateCompanyResearch(aiClient, { companyName, additionalContext: recordData });
                    recordData._companyResearch = {
                        ...research,
                        sources: research.sources,
                        researchedAt: new Date().toISOString(),
                    };
                    const researchTokens = research.usage.promptTokens + research.usage.completionTokens;
                    await updateTokenUsage(user.orgId, researchTokens);
                    await logAiUsage({
                        orgId: user.orgId,
                        userId: user.id,
                        provider: "gemini",
                        model: aiClient.model,
                        promptTokens: research.usage.promptTokens,
                        completionTokens: research.usage.completionTokens,
                        purpose: "test_company_research",
                    });
                } catch (err) {
                    console.error("[TestSend] Company research error:", err);
                }
            }
        }

        // 6. 제품 조회
        let product = null;
        if (link.productId) {
            const [p] = await db.select().from(products).where(eq(products.id, link.productId)).limit(1);
            product = p ?? null;
        }

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

        const emailTokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
        await updateTokenUsage(user.orgId, emailTokens);
        await logAiUsage({
            orgId: user.orgId,
            userId: user.id,
            provider: "gemini",
            model: aiClient.model,
            promptTokens: emailResult.usage.promptTokens,
            completionTokens: emailResult.usage.completionTokens,
            purpose: "test_personalized_email",
        });

        // 9. 서명 붙이기
        let finalBody = emailResult.htmlBody;
        if (signatureJson) {
            finalBody = appendSignature(finalBody, signatureJson);
        }

        // 10. NHN 테스트 발송
        const nhnResult = await emailClient.sendEachMail({
            senderAddress: sender.fromEmail,
            senderName: sender.fromName,
            title: `[테스트] ${emailResult.subject}`,
            body: finalBody,
            receiverList: [{ receiveMailAddr: testEmail, receiveType: "MRT0" }],
        });

        const sendResult = nhnResult.data?.results?.[0];
        const isSuccess = nhnResult.header.isSuccessful && (!sendResult || sendResult.resultCode === 0);

        return NextResponse.json({
            success: isSuccess,
            data: {
                subject: emailResult.subject,
                htmlBody: finalBody,
                sentTo: testEmail,
            },
            error: isSuccess ? undefined : (sendResult?.resultMessage ?? nhnResult.header.resultMessage),
        });
    } catch (error) {
        console.error("[TestSend] Error:", error);
        const message = error instanceof Error ? error.message : "서버 오류가 발생했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
