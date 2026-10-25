import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getSearchAiClient, generateCompanyResearch, checkTokenQuota, updateTokenUsage, logAiUsage } from "@/lib/ai";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = getSearchAiClient();
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
            provider: client.provider,
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
        const cause = error instanceof Error ? error.message : "";
        const connectionIssue = /\b(?:401|403)\b|credit|api.?key|auth|billing/i.test(cause);
        const message = connectionIssue
            ? "조직 AI 연결 확인이 필요합니다. 관리자에게 인증·이용 한도를 확인해주세요."
            : "회사 정보를 조회하지 못했습니다. 잠시 후 다시 시도해주세요.";
        return NextResponse.json({ success: false, error: message }, { status: 503 });
    }
}
