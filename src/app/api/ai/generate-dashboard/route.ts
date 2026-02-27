import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateDashboard, logAiUsage } from "@/lib/ai";

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
        const result = await generateDashboard(client, {
            prompt: prompt.trim(),
            workspaceFields: workspaceFields || [],
        });

        await logAiUsage({
            orgId: user.orgId,
            userId: user.userId,
            provider: client.provider,
            model: client.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            purpose: "dashboard_generation",
        });

        return NextResponse.json({
            success: true,
            data: {
                name: result.name,
                widgets: result.widgets,
            },
        });
    } catch (error) {
        console.error("AI dashboard generation error:", error);
        const message = error instanceof Error ? error.message : "AI 대시보드 생성에 실패했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
