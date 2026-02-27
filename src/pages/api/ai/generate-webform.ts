import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAiClient, generateWebForm, logAiUsage } from "@/lib/ai";

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

    const { prompt, workspaceFields } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "프롬프트를 입력해주세요." });
    }

    try {
        const result = await generateWebForm(client, {
            prompt: prompt.trim(),
            workspaceFields,
        });

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "webform_generation",
        });

        return res.status(200).json({
            success: true,
            data: {
                name: result.name,
                title: result.title,
                description: result.description,
                fields: result.fields,
            },
        });
    } catch (error) {
        console.error("AI webform generation error:", error);
        const message = error instanceof Error ? error.message : "AI 폼 생성에 실패했습니다.";
        return res.status(500).json({ success: false, error: message });
    }
}
