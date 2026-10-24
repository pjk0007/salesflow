import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { queryClient } from "@/lib/db";
import { kstDayBounds } from "@/lib/email-stats/rules";
import { describeReplyError } from "@/lib/email-reply-rules";
import { homeRange, homeTemplates } from "@/lib/email-stats/home";

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
        const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 10, 50);
        const [email, alimtalk] = await Promise.all([
            channel === "alimtalk" ? [] : homeTemplates(orgId, range),
            channel === "email" ? [] : queryClient<{ name: string | null; total: number; sent: number; failed: number }[]>`SELECT template_name AS name,count(*)::int total,
                count(*) FILTER(WHERE status='sent')::int sent,count(*) FILTER(WHERE status IN ('failed','rejected'))::int failed
                FROM alimtalk_send_logs WHERE org_id=${orgId} AND sent_at>=${fromIso} AND sent_at<${toIso} GROUP BY template_name ORDER BY count(*) DESC LIMIT ${limit}`,
        ]);
        const data = [
            ...email,
            ...alimtalk.map((row) => ({ name: row.name || "(이름 없음)", channel: "alimtalk", type: "template", total: row.total, sent: row.sent, failed: row.failed,
                clicked: 0, opened: 0, openBase: 0, openRate: null, successRate: row.total ? Math.round(row.sent / row.total * 100) : 0, clickRate: 0 })),
        ].sort((a, b) => b.total - a.total).slice(0, limit);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Analytics error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
