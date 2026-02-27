import { NextRequest, NextResponse } from "next/server";
import { processRepeatQueue } from "@/lib/alimtalk-automation";

export async function POST(req: NextRequest) {
    // CRON_SECRET 검증
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = req.headers.get("authorization");
        const querySecret = req.nextUrl.searchParams.get("secret");

        const provided = authHeader?.replace("Bearer ", "") || querySecret;
        if (provided !== cronSecret) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
    }

    try {
        const result = await processRepeatQueue();
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Process repeats error:", error);
        return NextResponse.json({ success: false, error: "처리에 실패했습니다." }, { status: 500 });
    }
}
