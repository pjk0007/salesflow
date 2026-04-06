import { NextRequest, NextResponse } from "next/server";
import { processAlimtalkFollowupQueue } from "@/lib/alimtalk-automation";

export async function GET(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    }
    const token = req.nextUrl.searchParams.get("token") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (token !== cronSecret) {
        return NextResponse.json({ success: false, error: "인증 실패" }, { status: 401 });
    }

    try {
        const result = await processAlimtalkFollowupQueue();
        console.log(`[cron] alimtalk-followup: processed=${result.processed}, sent=${result.sent}, failed=${result.failed}`);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error("[cron] alimtalk-followup error:", error);
        return NextResponse.json({ success: false, error: "처리 중 오류" }, { status: 500 });
    }
}
