import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { loadActiveHolds, loadSendHealthView } from "@/lib/sender-health-view";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 발신 건강 화면 데이터 (DESIGN-SND 9절·10절). 로그인한 조직 구성원이면 본다 — 멤버는 볼 수 있는 명단만.
 * { mode, dsnInRate, isAdmin, sync, partitions[], senders[], domains[], holds[], events[](14일) }. 받는 사람 주소는 없다.
 * ?scope=holds 이면 보류 중인 명단만 ({ holds, isAdmin }) — 명단 목록·레코드 화면 머리가 가볍게 읽는다.
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    try {
        if (req.nextUrl.searchParams.get("scope") === "holds") {
            return NextResponse.json({ success: true, data: await loadActiveHolds(user) });
        }
        const data = await loadSendHealthView(user);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("[send-health] view error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "발신 건강 정보를 불러오지 못했습니다." }, { status: 500 });
    }
}
