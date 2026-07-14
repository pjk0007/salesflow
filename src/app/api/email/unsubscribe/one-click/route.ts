import { NextRequest, NextResponse } from "next/server";
import { resolveUnsubscribeTarget, recordUnsubscribe } from "@/lib/email-unsubscribe";

// RFC 8058 원클릭 수신거부.
// 메일 클라이언트(Gmail/Apple 등)가 상단 "구독취소" 버튼을 누른 사용자를 대신해
// 이 URL로 POST한다. 본문은 List-Unsubscribe=One-Click 이지만 읽을 필요가 없다.
// 확인 절차 없이 즉시 처리해야 하며(스펙 요구사항), 인증도 없다.
export async function POST(req: NextRequest) {
    const token = req.nextUrl.searchParams.get("token");

    if (!token) {
        return NextResponse.json({ success: false, error: "토큰이 필요합니다." }, { status: 400 });
    }

    const target = await resolveUnsubscribeTarget(token);
    if (!target) {
        return NextResponse.json(
            { success: false, error: "유효하지 않거나 만료된 링크입니다." },
            { status: 404 }
        );
    }

    await recordUnsubscribe({
        orgId: target.orgId,
        workspaceId: target.workspaceId,
        email: target.email,
        sendLogId: target.sendLogId,
        recordId: target.recordId,
        source: "one_click",
    });

    return NextResponse.json({ success: true });
}
