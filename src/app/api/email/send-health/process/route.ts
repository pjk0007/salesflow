import { NextRequest, NextResponse } from "next/server";
import { runSendHealth } from "@/lib/sender-health";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 발신 건강 정기 작업 (DESIGN-SND 6절·9절). CloudType Scheduler가 10분마다(매시 5·15·25…분 — 동기화와 5분 어긋나게) 부른다
 * (`X-Secret: <CRON_SECRET>`). 동기화 건강 확인 → 판정 → 조치 → 사건·알림 줄(묶음) → 보내기 → (09시 KST 뒤) 매일 보고.
 * 응답: { mode, orgs, danger, caution, holds, pauses, authBursts, gated, events, alertsSent, alertsFailed, report, skipped? }
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
        const stats = await runSendHealth();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        // 오류 객체를 통째로 찍지 않는다 — 쿼리 매개변수가 로그에 남는다
        console.error("[send-health] process error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "발신 건강 판정에 실패했습니다." }, { status: 500 });
    }
}
