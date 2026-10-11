import { NextRequest, NextResponse } from "next/server";
import { processReplySync } from "@/lib/email-reply-sync";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 회신 메일함 읽기 정기 작업 (DESIGN-RPL 10-3·10-4). CloudType Scheduler가 5분마다 부른다 (`X-Secret: <CRON_SECRET>`).
 * 응답에는 숫자와 모드만 있다 (주소·제목 없음).
 */
export async function POST(req: NextRequest) {
    // CRON_SECRET 검증 — 깊이 알림 라우트와 같다 (x-secret 머리글·Bearer·?secret=)
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
        const stats = await processReplySync();
        return NextResponse.json({ success: true, data: stats });
    } catch (error) {
        // 오류 객체를 통째로 찍지 않는다 — 실패한 쿼리의 매개변수(발췌·주소)가 로그에 남는다
        console.error("[reply-sync] process error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "회신 읽기에 실패했습니다." }, { status: 500 });
    }
}
