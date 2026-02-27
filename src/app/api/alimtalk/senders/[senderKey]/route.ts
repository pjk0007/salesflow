import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ senderKey: string }> }
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
        const { senderKey } = await params;
        if (!senderKey) {
            return NextResponse.json({ success: false, error: "senderKey는 필수입니다." }, { status: 400 });
        }

        const result = await client.deleteSender(senderKey);

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            message: "발신프로필이 삭제되었습니다.",
        });
    } catch (error) {
        console.error("Sender delete error:", error);
        return NextResponse.json({ success: false, error: "발신프로필 삭제에 실패했습니다." }, { status: 500 });
    }
}
