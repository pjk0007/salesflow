import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getSenderUsage } from "@/lib/email-sender-limit";

/**
 * 주소별 오늘 보낸 수·오늘 한도·웜업 며칠째·앞으로 14일 하루 한도.
 * 보기만 하므로 조직 구성원이면 누구나 본다 (바꾸는 것은 PUT /api/email/sender-profiles/[id], 관리자).
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const usage = await getSenderUsage(user.orgId);
        return NextResponse.json({ success: true, data: usage });
    } catch (error) {
        console.error("Sender profile usage fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
