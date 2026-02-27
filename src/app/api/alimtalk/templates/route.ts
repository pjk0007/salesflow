import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";
import type { NhnRegisterTemplateRequest } from "@/lib/nhn-alimtalk";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const senderKey = req.nextUrl.searchParams.get("senderKey");
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        const result = await client.listTemplates(senderKey);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            data: {
                templates: result.templates,
                totalCount: result.totalCount,
            },
        });
    } catch (error) {
        console.error("Templates list error:", error);
        return NextResponse.json({ success: false, error: "템플릿 조회에 실패했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { senderKey, ...templateData } = await req.json() as { senderKey: string } & NhnRegisterTemplateRequest;

        if (!senderKey || !templateData.templateCode || !templateData.templateName || !templateData.templateContent) {
            return NextResponse.json({
                success: false,
                error: "senderKey, templateCode, templateName, templateContent는 필수입니다.",
            }, { status: 400 });
        }

        const result = await client.registerTemplate(senderKey, templateData);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            message: "템플릿이 등록되었습니다.",
        });
    } catch (error) {
        console.error("Template register error:", error);
        return NextResponse.json({ success: false, error: "템플릿 등록에 실패했습니다." }, { status: 500 });
    }
}
