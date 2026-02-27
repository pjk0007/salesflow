import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateProduct, logAiUsage } from "@/lib/ai";
import { scrapeImageUrl } from "@/lib/scrape-image";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getAiClient(user.orgId);
    if (!client) {
        return res.status(400).json({
            success: false,
            error: "AI 설정이 필요합니다. 설정 > AI 탭에서 API 키를 등록해주세요.",
        });
    }

    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "제품명 또는 URL을 입력해주세요." });
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

        return res.status(200).json({
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
        return res.status(500).json({ success: false, error: message });
    }
}
