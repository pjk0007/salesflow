import { NextRequest, NextResponse } from "next/server";
import { runStatusSync } from "@/lib/email-status-sync";

/**
 * NHN 발송 결과 자동 맞추기 정기 작업 (DESIGN-SND 3절·9절). CloudType Scheduler가 10분마다(매시 0·10·20…분) 부른다
 * (`X-Secret: <CRON_SECRET>`). NHN_STATUS_SYNC=off면 { skipped: "off" }.
 * 응답: { groups, calls, windows, updated, finalized, failedNew, unpaired, fallbackCalls, errors, skippedWindows, skippedAsLocked? }
 */
export async function POST(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });
    }

    const token =
        req.headers.get("x-secret") ||
        req.headers.get("authorization")?.replace("Bearer ", "") ||
        req.nextUrl.searchParams.get("secret");

    if (token !== cronSecret) {
        return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    }

    try {
        const stats = await runStatusSync();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        // 오류 객체를 통째로 찍지 않는다 — 쿼리 매개변수에 받는 주소가 섞일 수 있다
        console.error("[status-sync] process error:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
        return NextResponse.json({ success: false, error: "발송 결과 맞추기에 실패했습니다." }, { status: 500 });
    }
}
