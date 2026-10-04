import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, products, records } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient, getEmailConfig, appendSignature } from "@/lib/nhn-email";
import { getAiClient, getSearchAiClient, generateEmail, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";
import { resolveSender, resolveSignature } from "@/lib/email-sender-resolver";
import { linkSenderPool } from "@/lib/email-sender-limit-rules";
import { substitutePromptVariables } from "@/lib/email-utils";
import { newReplyToResolver } from "@/lib/email-reply-to";
import { buildCustomHeaders } from "@/lib/reply-to-rules";

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
        // id는 양의 정수만 — 문자열 등을 그대로 쿼리에 넘기면 DB 형 오류가 나고, 그 오류 문구에 쿼리가 담긴다
        if (!isPositiveId(linkId) || (recordId !== undefined && recordId !== null && recordId !== "" && !isPositiveId(recordId))) {
            return NextResponse.json({ success: false, error: "규칙 또는 레코드 id가 올바르지 않습니다." }, { status: 400 });
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
            // 이 조직 레코드만 — 조직 조건이 없으면 남의 레코드 내용이 AI 프롬프트에 들어간다
            const [record] = await db
                .select()
                .from(records)
                .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)))
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

        // 3. AI 클라이언트 (규칙에 저장된 모델 사용)
        const aiClient = getAiClient(link.model || undefined);
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

        // 테스트 발송도 규칙에 지정된 발신 프로필·서명을 따라야 실제 발송과 결과가 같다.
        // 묶음이면 첫 주소로 보낸다 (실제 발송은 그중 가장 오래 쉰 주소). 일회성이라 한도 자리는 잡지 않는다
        const sender = await resolveSender(user.orgId, {
            preferredIds: linkSenderPool(link),
            config: emailConfig,
        });
        if (!sender.fromEmail) {
            return NextResponse.json({ success: false, error: "발신자 프로필이 설정되지 않았습니다." }, { status: 400 });
        }

        // DB의 null은 "미지정" (HTTP body의 null과 의미가 다르다)
        const signatureJson = await resolveSignature(user.orgId, {
            requestedId: link.signatureId ?? undefined,
            config: emailConfig,
        });

        // 5. 회사 조사 (autoResearch ON && 레코드에 _companyResearch 없으면)
        if (link.autoResearch === 1 && !recordData._companyResearch) {
            const companyName = recordData[link.companyField] as string;
            const searchClient = getSearchAiClient();  // 회사 리서치는 웹검색 필요 → SEARCH_MODEL_ID 고정
            if (searchClient && companyName && typeof companyName === "string" && companyName.trim()) {
                try {
                    const research = await generateCompanyResearch(searchClient, { companyName, additionalContext: recordData });
                    recordData._companyResearch = {
                        ...research,
                        sources: research.sources,
                        researchedAt: new Date().toISOString(),
                    };
                    const researchTokens = research.usage.promptTokens + research.usage.completionTokens;
                    await updateTokenUsage(user.orgId, researchTokens);
                    await logAiUsage({
                        orgId: user.orgId,
                        userId: user.userId,
                        provider: searchClient.provider,
                        model: searchClient.model,
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

        // 8. AI 이메일 생성 — 프롬프트의 ##필드명## 변수를 레코드 값으로 치환
        const rawPrompt = link.prompt || "이 회사에 적합한 제품 소개 이메일을 작성해주세요.";
        const prompt = substitutePromptVariables(rawPrompt, recordData);
        const emailResult = await generateEmail(aiClient, {
            prompt,
            product,
            recordData,
            tone: link.tone || undefined,
            ctaUrl: link.ctaUrl || product?.url || undefined,
            format: (link.format as "plain" | "designed") || "plain",
            senderPersona,
        });

        const emailTokens = emailResult.usage.promptTokens + emailResult.usage.completionTokens;
        await updateTokenUsage(user.orgId, emailTokens);
        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: aiClient.provider,
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

        // 10. NHN 테스트 발송. 답장 받을 주소는 이 규칙이 실제로 보낼 레코드의 워크스페이스(규칙 파티션의 워크스페이스) 값 —
        // 테스트 메일에 답장해 보면 실제 메일의 답장이 어디로 가는지 확인할 수 있다 (DESIGN-3 4절)
        const replyTo = await newReplyToResolver().forPartition(link.partitionId);
        const nhnResult = await emailClient.sendEachMail({
            senderAddress: sender.fromEmail,
            senderName: sender.fromName,
            title: `[테스트] ${emailResult.subject}`,
            body: finalBody,
            receiverList: [{ receiveMailAddr: testEmail, receiveType: "MRT0" }],
            ...buildCustomHeaders({ replyTo }),
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
        // 원래 오류 문구는 서버 로그에만 남긴다 — DB 오류 문구에는 쿼리 원문과 매개변수가 담겨 화면으로 나가면 안 된다
        console.error("[TestSend] Error:", error);
        return NextResponse.json(
            { success: false, error: "테스트 발송 중 오류가 발생했습니다. 잠시 뒤 다시 시도해주세요." },
            { status: 500 }
        );
    }
}

/** 양의 정수 id인가. 화면은 숫자를 보낸다 */
function isPositiveId(v: unknown): v is number {
    return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
