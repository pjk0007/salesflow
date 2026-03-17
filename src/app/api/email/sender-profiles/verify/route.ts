import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailClient } from "@/lib/nhn-email";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getEmailClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { fromEmail, fromName } = await req.json();
        if (!fromEmail || !fromEmail.includes("@")) {
            return NextResponse.json({ success: false, error: "유효한 이메일 주소를 입력해주세요." }, { status: 400 });
        }

        const result = await client.sendEachMail({
            senderAddress: fromEmail,
            senderName: fromName || undefined,
            title: "[Sendb] 발신자 이메일 확인",
            body: "<p>이 메일은 Sendb에서 발신자 이메일 주소를 확인하기 위해 발송되었습니다.</p><p>이 메일을 수신하셨다면 발신자 이메일이 정상적으로 등록되어 있습니다.</p>",
            receiverList: [{ receiveMailAddr: fromEmail, receiveType: "MRT0" }],
        });

        if (result.header.isSuccessful) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({
                success: false,
                error: result.header.resultMessage || "발송에 실패했습니다. NHN에 등록된 발신 주소인지 확인해주세요.",
            });
        }
    } catch (error) {
        console.error("Sender profile verify error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
