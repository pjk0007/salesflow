import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export async function POST(
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

    try {
        const { templateCode } = await params;
        const { senderKey, comment } = await req.json() as { senderKey: string; comment: string };

        if (!templateCode || !senderKey || !comment) {
            return NextResponse.json({
                success: false,
                error: "templateCode, senderKey, comment는 필수입니다.",
            }, { status: 400 });
        }

        const result = await client.commentTemplate(senderKey, templateCode, comment);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({ success: true, message: "검수 요청이 완료되었습니다." });
    } catch (error) {
        console.error("Template comment error:", error);
        return NextResponse.json({ success: false, error: "검수 요청에 실패했습니다." }, { status: 500 });
    }
}
