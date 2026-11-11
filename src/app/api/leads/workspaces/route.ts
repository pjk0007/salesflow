import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getLeadWorkspaces } from "@/lib/leads/stats";

// GET: 리드 관리 파티션이 있는 워크스페이스 + 리드 수 — 리드 관리·리드 통계 상단 탭
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    try {
        return NextResponse.json({ success: true, data: await getLeadWorkspaces(user.orgId) });
    } catch (error) {
        console.error("Lead workspaces error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
