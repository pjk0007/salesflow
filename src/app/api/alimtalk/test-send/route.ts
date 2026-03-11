import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const { senderKey, templateCode, recipientNo, templateParameter } = await req.json();

        if (!senderKey || !templateCode || !recipientNo) {
            return NextResponse.json({
                success: false,
                error: "senderKey, templateCode, recipientNo는 필수입니다.",
            }, { status: 400 });
        }

        const normalized = normalizePhoneNumber(recipientNo);
        if (normalized.length < 10) {
            return NextResponse.json({
                success: false,
                error: "유효하지 않은 수신번호입니다.",
            }, { status: 400 });
        }

        const nhnResult = await client.sendMessages({
            senderKey,
            templateCode,
            recipientList: [{
                recipientNo: normalized,
                templateParameter: templateParameter || undefined,
            }],
        });

        if (!nhnResult.header.isSuccessful) {
            return NextResponse.json({
                success: false,
                error: `발송 실패: ${nhnResult.header.resultMessage}`,
            });
        }

        const sendResponse = nhnResult.message;
        if (!sendResponse) {
            return NextResponse.json({
                success: false,
                error: "NHN Cloud에서 응답을 받지 못했습니다.",
            });
        }

        const result = sendResponse.sendResults[0];
        return NextResponse.json({
            success: result.resultCode === 0,
            data: {
                requestId: sendResponse.requestId,
                resultCode: result.resultCode,
                resultMessage: result.resultMessage,
            },
            ...(result.resultCode !== 0 && { error: result.resultMessage }),
        });
    } catch (error) {
        console.error("Alimtalk test-send error:", error);
        return NextResponse.json({ success: false, error: "발송에 실패했습니다." }, { status: 500 });
    }
}
