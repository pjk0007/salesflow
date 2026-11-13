import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { queryClient } from "@/lib/db";

// GET: 메일을 보낸 적 있는 사업부 id — 리드젠통계 기본 탭
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    try {
        const rows = await queryClient<{ workspace_id: number }[]>`
            SELECT DISTINCT workspace_id FROM email_stats_daily
            WHERE org_id=${user.orgId}::uuid AND grain='total' AND workspace_id > 0 AND sent > 0`;
        return NextResponse.json({ success: true, data: rows.map((r) => r.workspace_id) });
    } catch (error) {
        console.error("[email-stats] 발송 사업부 읽기 실패:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
