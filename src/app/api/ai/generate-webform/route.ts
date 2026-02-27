import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateWebForm, logAiUsage } from "@/lib/ai";

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

    const { prompt, workspaceFields } = await req.json();
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return NextResponse.json({ success: false, error: "프롬프트를 입력해주세요." }, { status: 400 });
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

        return NextResponse.json({
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
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
