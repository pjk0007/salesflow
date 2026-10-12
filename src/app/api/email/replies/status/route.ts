import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { isReplyScopeOrg } from "@/lib/email-reply-list";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 이 조직에 회신 탭을 보일지 (RH-SEC-5·OPS-6). 회신 메일함은 매치스플랜 대표 메일함 하나라
 * 회신 읽기 대상 조직(REPLY_WORKSPACE_IDS, 없으면 DEEP_ALERT_WORKSPACE_IDS의 조직)에만 탭을 보인다.
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    try {
        return NextResponse.json({ success: true, data: { enabled: await isReplyScopeOrg(user.orgId) } });
    } catch (error) {
        console.error("[replies] status error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
