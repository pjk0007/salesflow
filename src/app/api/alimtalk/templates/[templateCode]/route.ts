import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";
import type { NhnUpdateTemplateRequest } from "@/lib/nhn-alimtalk";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ templateCode: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    const { templateCode } = await params;
    if (!templateCode) {
        return NextResponse.json({ success: false, error: "templateCode는 필수입니다." }, { status: 400 });
    }

    try {
        const senderKey = req.nextUrl.searchParams.get("senderKey");
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        const result = await client.getTemplate(senderKey, templateCode);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({ success: true, data: result.template });
    } catch (error) {
        console.error("Template detail error:", error);
        return NextResponse.json({ success: false, error: "템플릿 상세 조회에 실패했습니다." }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ templateCode: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    const { templateCode } = await params;
    if (!templateCode) {
        return NextResponse.json({ success: false, error: "templateCode는 필수입니다." }, { status: 400 });
    }

    try {
        const { senderKey, ...templateData } = await req.json() as { senderKey: string } & NhnUpdateTemplateRequest;

        if (!senderKey || !templateData.templateName || !templateData.templateContent) {
            return NextResponse.json({
                success: false,
                error: "senderKey, templateName, templateContent는 필수입니다.",
            }, { status: 400 });
        }

        const result = await client.updateTemplate(senderKey, templateCode, templateData);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({ success: true, message: "템플릿이 수정되었습니다." });
    } catch (error) {
        console.error("Template update error:", error);
        return NextResponse.json({ success: false, error: "템플릿 수정에 실패했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ templateCode: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    const { templateCode } = await params;
    if (!templateCode) {
        return NextResponse.json({ success: false, error: "templateCode는 필수입니다." }, { status: 400 });
    }

    try {
        const senderKey = req.nextUrl.searchParams.get("senderKey");
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        const result = await client.deleteTemplate(senderKey, templateCode);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({ success: true, message: "템플릿이 삭제되었습니다." });
    } catch (error) {
        console.error("Template delete error:", error);
        return NextResponse.json({ success: false, error: "템플릿 삭제에 실패했습니다." }, { status: 500 });
    }
}
