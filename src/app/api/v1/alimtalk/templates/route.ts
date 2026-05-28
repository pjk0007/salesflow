import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkConfigs } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";
import { authenticateExternalAlimtalk } from "@/lib/alimtalk/external-auth";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
    const tokenInfo = await authenticateExternalAlimtalk(req);
    if (!tokenInfo) {
        return NextResponse.json(
            { success: false, error: "유효하지 않은 API 토큰입니다." },
            { status: 401 },
        );
    }

    const client = await getAlimtalkClient(tokenInfo.orgId);
    if (!client) {
        return NextResponse.json(
            { success: false, error: "알림톡 설정이 없습니다." },
            { status: 404 },
        );
    }

    let senderKey = req.nextUrl.searchParams.get("senderKey") ?? undefined;
    if (!senderKey) {
        const [config] = await db
            .select({ defaultSenderKey: alimtalkConfigs.defaultSenderKey })
            .from(alimtalkConfigs)
            .where(
                and(
                    eq(alimtalkConfigs.orgId, tokenInfo.orgId),
                    eq(alimtalkConfigs.isActive, 1),
                ),
            )
            .limit(1);
        senderKey = config?.defaultSenderKey ?? undefined;
    }

    if (!senderKey) {
        return NextResponse.json(
            { success: false, error: "senderKey가 필요합니다." },
            { status: 400 },
        );
    }

    const result = await client.listTemplates(senderKey);
    if (!result.header.isSuccessful) {
        return NextResponse.json(
            {
                success: false,
                error: `템플릿 조회 실패: ${result.header.resultMessage}`,
            },
            { status: 502 },
        );
    }

    // 승인된 템플릿(TSC03)만 외부에 노출. 검수중/반려/중단/생성 상태는 제외.
    const approved = result.templates.filter((tpl) => tpl.status === "TSC03");

    return NextResponse.json({
        success: true,
        data: {
            senderKey,
            totalCount: approved.length,
            templates: approved,
        },
    });
}

// GET /api/v1/alimtalk/templates?senderKey=...
export async function GET(req: NextRequest) {
    let res: NextResponse;
    try {
        res = await handleGet(req);
    } catch (error) {
        console.error("External alimtalk templates error:", {
            message: error instanceof Error ? error.message : String(error),
        });
        res = NextResponse.json(
            { success: false, error: "템플릿 조회에 실패했습니다." },
            { status: 500 },
        );
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.headers.set(k, v);
    }
    return res;
}
