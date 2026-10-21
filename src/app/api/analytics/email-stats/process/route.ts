import { NextRequest, NextResponse } from "next/server";
import { runEmailStats } from "@/lib/email-stats/worker";
import { describeReplyError } from "@/lib/email-reply-rules";

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret)
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    const token = req.headers.get("x-secret") || req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
    if (token !== secret)
        return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    try {
        const data = await runEmailStats({
            force: req.nextUrl.searchParams.get("force") === "nightly" ? "nightly" : undefined
        });
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("[email-stats] process error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "이메일 통계 집계에 실패했습니다." }, { status: 500 });
    }
}
