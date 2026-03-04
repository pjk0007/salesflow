import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";

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

    const { companyName, recordData } = await req.json();
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        return NextResponse.json({ success: false, error: "회사명을 입력해주세요." }, { status: 400 });
    }

    try {
        const result = await generateCompanyResearch(client, {
            companyName: companyName.trim(),
            additionalContext: recordData as Record<string, unknown> | undefined,
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
            purpose: "company_research",
        });

        return NextResponse.json({
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
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
