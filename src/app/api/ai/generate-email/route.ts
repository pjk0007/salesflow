import { NextRequest, NextResponse } from "next/server";
import { db, products, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateEmail, logAiUsage } from "@/lib/ai";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAiClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요." }, { status: 400 });
    }

    const { prompt, productId, recordId, tone, ctaUrl } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "프롬프트를 입력해주세요." }, { status: 400 });
    }

    try {
        // 제품 정보 조회 (선택)
        let product = null;
        if (productId) {
            const [p] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            product = p ?? null;
        }

        // 레코드 정보 조회 (선택)
        let recordData = null;
        if (recordId) {
            const [r] = await db.select().from(records).where(eq(records.id, recordId)).limit(1);
            if (r) recordData = r.data as Record<string, unknown>;
        }

        const result = await generateEmail(client, {
            prompt: prompt.trim(),
            product,
            recordData,
            tone,
            ctaUrl,
        });

        // 사용량 로깅
        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "email_generation",
        });

        return NextResponse.json({
            success: true,
            data: {
                subject: result.subject,
                htmlBody: result.htmlBody,
            },
        });
    } catch (error) {
        console.error("AI email generation error:", error);
        const message = error instanceof Error ? error.message : "AI 이메일 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
