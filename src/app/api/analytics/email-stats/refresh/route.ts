import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { refreshStats } from "@/lib/email-stats/refresh-store";
import { describeReplyError } from "@/lib/email-reply-rules";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user)
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member")
        return NextResponse.json({ success: false, error: "관리자만 갱신할 수 있습니다." }, { status: 403 });
    try {
        const result = await refreshStats(user.orgId);
        return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
        console.error("[email-stats] 수동 갱신 실패:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "이메일 통계를 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
}
