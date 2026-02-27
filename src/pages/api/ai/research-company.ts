import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateCompanyResearch, logAiUsage } from "@/lib/ai";

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

    const { companyName } = req.body;
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        return res.status(400).json({ success: false, error: "회사명을 입력해주세요." });
    }

    try {
        const result = await generateCompanyResearch(client, { companyName: companyName.trim() });

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.provider === "openai" ? "gpt-4o-search-preview" : client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "company_research",
        });

        return res.status(200).json({
            success: true,
            data: {
                companyName: result.companyName,
                industry: result.industry,
                description: result.description,
                services: result.services,
                employees: result.employees,
                website: result.website,
                sources: result.sources,
            },
        });
    } catch (error) {
        console.error("AI company research error:", error);
        const message = error instanceof Error ? error.message : "AI 회사 조사에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
