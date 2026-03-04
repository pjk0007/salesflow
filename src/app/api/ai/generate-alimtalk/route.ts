import { NextRequest, NextResponse } from "next/server";
import { db, products } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateAlimtalk, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = getAiClient();
    if (!client) {
        return NextResponse.json({ success: false, error: "AI 서비스를 사용할 수 없습니다." }, { status: 503 });
    }

    const quota = await checkTokenQuota(user.orgId);
    if (!quota.allowed) {
        return NextResponse.json({
            success: false,
            error: "이번 달 AI 사용량을 초과했습니다. 플랜 업그레이드를 고려해주세요.",
        }, { status: 429 });
    }

    const { prompt, productId, tone } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "프롬프트를 입력해주세요." }, { status: 400 });
    }

    try {
        let product = null;
        if (productId) {
            const [p] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            product = p ?? null;
        }

        const result = await generateAlimtalk(client, {
            prompt: prompt.trim(),
            product,
            tone,
        });

        const totalTokens = result.usage.promptTokens + result.usage.completionTokens;
        await updateTokenUsage(user.orgId, totalTokens);

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: "gemini",
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "alimtalk_generation",
        });

        return NextResponse.json({
            success: true,
            data: {
                templateName: result.templateName,
                templateContent: result.templateContent,
                templateMessageType: result.templateMessageType,
                buttons: result.buttons,
            },
        });
    } catch (error) {
        console.error("AI alimtalk generation error:", error);
        const message = error instanceof Error ? error.message : "AI 알림톡 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
