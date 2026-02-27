import { NextRequest, NextResponse } from "next/server";
import { processEmailRepeatQueue } from "@/lib/email-automation";

export async function POST(req: NextRequest) {
    // CRON_SECRET 검증
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");

    if (token !== cronSecret) {
        return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    }

    try {
        const stats = await processEmailRepeatQueue();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        console.error("Email repeat queue error:", error);
        return NextResponse.json({ success: false, error: "처리에 실패했습니다." }, { status: 500 });
    }
}
