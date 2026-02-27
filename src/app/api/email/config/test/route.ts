import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { NhnEmailClient } from "@/lib/nhn-email";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { appKey, secretKey } = await req.json();
    if (!appKey || !secretKey) {
        return NextResponse.json({ success: false, error: "appKey와 secretKey는 필수입니다." }, { status: 400 });
    }

    try {
        const client = new NhnEmailClient(appKey, secretKey);
        const today = new Date().toISOString().slice(0, 10) + " 00:00:00";
        const result = await client.queryMails({ startSendDate: today, endSendDate: today, pageNum: 1, pageSize: 1 });

        if (result.header.isSuccessful) {
            return NextResponse.json({ success: true, message: "연결 성공" });
        } else {
            return NextResponse.json({
                success: false,
                error: `연결 실패: ${result.header.resultMessage}`,
            });
        }
    } catch (error) {
        console.error("Email config test error:", error);
        return NextResponse.json({ success: false, error: "연결 테스트에 실패했습니다." }, { status: 500 });
    }
}
