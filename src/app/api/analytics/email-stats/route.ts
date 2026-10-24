import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { queryClient } from "@/lib/db";
import { parseStatsQuery } from "@/lib/email-stats/query";
import { readKpi } from "@/lib/email-stats/read-kpi";
import { readTrend, readCompare } from "@/lib/email-stats/read-series";
import { describeReplyError } from "@/lib/email-reply-rules";

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user)
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const now = new Date();
    const query = parseStatsQuery(req.nextUrl.searchParams, now);
    if (!query.ok)
        return NextResponse.json({ success: false, error: query.error }, { status: 400 });
    try {
        if (query.workspaceId !== null) {
            const rows = await queryClient`SELECT 1 FROM workspaces WHERE id=${query.workspaceId} AND org_id=${user.orgId}`;
            if (!rows.length)
                return NextResponse.json({ success: false, error: "워크스페이스를 확인해 주세요." }, { status: 400 });
        }
        const data = query.view === "kpi" ? await readKpi(user.orgId, query)
            : query.view === "trend" ? await readTrend(user.orgId, query, now) : await readCompare(user.orgId, query, query.axis);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("[email-stats] 읽기 실패:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "이메일 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
}
