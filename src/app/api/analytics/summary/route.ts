import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { queryClient } from "@/lib/db";
import { kstDayBounds } from "@/lib/email-stats/rules";
import { describeReplyError } from "@/lib/email-reply-rules";
import { homeRange, homeSummary } from "@/lib/email-stats/home";

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
        const [email, rows] = await Promise.all([
            homeSummary(orgId, range),
            queryClient<{ status: string; count: number }[]>`SELECT status,count(*)::int count FROM alimtalk_send_logs WHERE org_id=${orgId} AND sent_at>=${fromIso} AND sent_at<${toIso} GROUP BY status`,
        ]);
        const alimtalk = { total: 0, sent: 0, failed: 0, pending: 0 };
        for (const row of rows) {
            alimtalk.total += row.count;
            if (row.status === "sent") alimtalk.sent += row.count;
            else if (row.status === "failed" || row.status === "rejected") alimtalk.failed += row.count;
            else if (row.status === "pending") alimtalk.pending += row.count;
        }
        return NextResponse.json({ success: true, data: { alimtalk, ...email } });
    } catch (error) {
        console.error("Analytics error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
