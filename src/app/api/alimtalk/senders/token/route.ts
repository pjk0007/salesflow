import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

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
        const { plusFriendId, token } = await req.json();
        if (!plusFriendId || !token) {
            return NextResponse.json({
                success: false,
                error: "plusFriendId와 token은 필수입니다.",
            }, { status: 400 });
        }

        const result = await client.authenticateSenderToken({ plusFriendId, token });

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            message: "발신프로필 인증이 완료되었습니다.",
        });
    } catch (error) {
        console.error("Sender token auth error:", error);
        return NextResponse.json({ success: false, error: "토큰 인증에 실패했습니다." }, { status: 500 });
    }
}
