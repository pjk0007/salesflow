import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAiClient, generateCompanyResearch, logAiUsage } from "@/lib/ai";

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

    const { companyName } = await req.json();
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        return NextResponse.json({ success: false, error: "회사명을 입력해주세요." }, { status: 400 });
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
