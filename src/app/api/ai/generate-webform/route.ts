import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateWebForm, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";

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

    const { prompt, workspaceFields } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "프롬프트를 입력해주세요." }, { status: 400 });
    }

    try {
        const result = await generateWebForm(client, { prompt: prompt.trim(), workspaceFields });

        const totalTokens = result.usage.promptTokens + result.usage.completionTokens;
        await updateTokenUsage(user.orgId, totalTokens);

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: "gemini",
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "webform_generation",
        });

        return NextResponse.json({
            success: true,
            data: { name: result.name, title: result.title, description: result.description, fields: result.fields },
        });
    } catch (error) {
        console.error("AI webform generation error:", error);
        const message = error instanceof Error ? error.message : "AI 폼 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
