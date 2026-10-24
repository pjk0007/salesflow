import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { queryClient } from "@/lib/db";
import { kstDayBounds } from "@/lib/email-stats/rules";
import { describeReplyError } from "@/lib/email-reply-rules";
import { homeRange, homeTrends } from "@/lib/email-stats/home";
import { mergeHomeTrends } from "@/lib/email-stats/home-map";

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const from = req.nextUrl.searchParams.get("startDate");
    const to = req.nextUrl.searchParams.get("endDate");
    if (!from || !to) return NextResponse.json({ success: false, error: "startDate, endDate는 필수입니다." }, { status: 400 });
    const range = homeRange(from, to);
    if (!range) return NextResponse.json({ success: false, error: "startDate, endDate는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    const { fromIso, toIso } = kstDayBounds(range.from, range.to);
    const orgId = user.orgId;
    try {
        const channel = req.nextUrl.searchParams.get("channel") || "all";
        const [email, alimtalk] = await Promise.all([
            channel === "alimtalk" ? [] : homeTrends(orgId, range),
            channel === "email" ? [] : queryClient<{ date: string; sent: number; failed: number }[]>`SELECT (sent_at AT TIME ZONE 'Asia/Seoul')::date::text AS date,
                count(*) FILTER(WHERE status='sent')::int sent,count(*) FILTER(WHERE status IN ('failed','rejected'))::int failed
                FROM alimtalk_send_logs WHERE org_id=${orgId} AND sent_at>=${fromIso} AND sent_at<${toIso} GROUP BY 1 ORDER BY 1`,
        ]);
        return NextResponse.json({ success: true, data: mergeHomeTrends(email, alimtalk) });
    } catch (error) {
        console.error("Analytics error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
