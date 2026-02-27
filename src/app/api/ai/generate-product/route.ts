import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateProduct, logAiUsage } from "@/lib/ai";
import { scrapeImageUrl } from "@/lib/scrape-image";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAiClient(user.orgId);
    if (!client) {
        return NextResponse.json({
            success: false,
            error: "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요.",
        }, { status: 400 });
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "제품명 또는 URL을 입력해주세요." }, { status: 400 });
    }

    try {
        const result = await generateProduct(client, { prompt: prompt.trim() });

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.provider === "openai" ? "gpt-4o-search-preview" : client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "product_generation",
        });

        // imageUrl이 없으면 사이트에서 og:image / favicon 추출
        let imageUrl = result.imageUrl;
        if (!imageUrl && result.url) {
            imageUrl = await scrapeImageUrl(result.url) ?? undefined;
        }

        return NextResponse.json({
            success: true,
            data: {
                name: result.name,
                summary: result.summary,
                description: result.description,
                category: result.category,
                price: result.price,
                url: result.url,
                imageUrl,
                sources: result.sources,
            },
        });
    } catch (error) {
        console.error("AI product generation error:", error);
        const message = error instanceof Error ? error.message : "AI 제품 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
