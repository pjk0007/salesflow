import { NextRequest, NextResponse } from "next/server";
import { processDeepVisitorAlerts, describeDeepAlertError } from "@/lib/deep-visitor-alert";

export async function POST(req: NextRequest) {
    // CRON_SECRET 검증
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    }

    const token = req.headers.get("x-secret") || req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");

    if (token !== cronSecret) {
        return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    }

    try {
        const stats = await processDeepVisitorAlerts();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        // 오류 객체를 통째로 찍지 않는다 — 실패한 쿼리의 매개변수(카드 글자)가 로그에 남는다
        console.error("[deep-alert] process error:", describeDeepAlertError(error));
        return NextResponse.json({ success: false, error: "처리에 실패했습니다." }, { status: 500 });
    }
}
