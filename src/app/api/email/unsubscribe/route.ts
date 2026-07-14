import { NextRequest, NextResponse } from "next/server";
import {
    resolveUnsubscribeTarget,
    recordUnsubscribe,
    attachUnsubscribeReason,
} from "@/lib/email-unsubscribe";

// 확인 페이지가 "누구를 거부하는지" 보여주기 위한 조회. 인증 없음.
export async function GET(req: NextRequest) {
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

    return NextResponse.json({
        success: true,
        data: { email: target.email, alreadyUnsubscribed: target.alreadyUnsubscribed },
    });
}

// 수신 거부 처리. 메일 수신자가 확인 페이지에서 호출하므로 인증이 없다.
// 토큰은 발송 건마다 새로 발급되며 이메일 주소를 URL에 노출하지 않는다.
// 사유는 받지 않는다 — 거부를 막는 어떤 절차도 두지 않기 위함(PATCH로 사후 수집).
export async function POST(req: NextRequest) {
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
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
        source: "link",
    });

    return NextResponse.json({ success: true, data: { email: target.email } });
}

// 거부 완료 후 사유만 덧붙인다. 남기지 않아도 거부는 이미 끝나 있다.
export async function PATCH(req: NextRequest) {
    const { token, reason } = await req.json();

    if (!token || typeof token !== "string") {
        return NextResponse.json({ success: false, error: "토큰이 필요합니다." }, { status: 400 });
    }
    if (typeof reason !== "string" || !reason.trim()) {
        return NextResponse.json({ success: false, error: "사유가 필요합니다." }, { status: 400 });
    }

    const updated = await attachUnsubscribeReason(token, reason.trim());
    if (!updated) {
        return NextResponse.json(
            { success: false, error: "수신거부 내역을 찾을 수 없습니다." },
            { status: 404 }
        );
    }

    return NextResponse.json({ success: true });
}
