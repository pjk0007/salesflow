import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient, normalizePhoneNumber } from "@/lib/nhn-alimtalk";
import { classifyAlimtalkSubmission } from "@/lib/nhn-submit-result";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
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

        let nhnResult: Awaited<ReturnType<typeof client.sendMessages>> | undefined;
        try {
            nhnResult = await client.sendMessages({
                senderKey,
                templateCode,
                recipientList: [{
                    recipientNo: normalized,
                    templateParameter: templateParameter || undefined,
                }],
            });
        } catch (error) {
            // 요청이 나간 뒤의 예외는 접수 여부를 알 수 없다 — 실패로 단정하지 않는다.
            console.error("Alimtalk test-send response lost:", error);
        }

        // 개별 접수 성공은 "접수됨"이다. 실제 수신 성공·실패는 카카오 처리 후 확정된다.
        const status = classifyAlimtalkSubmission(nhnResult);
        const result = nhnResult?.message?.sendResults?.[0];
        const resultMessage = result?.resultMessage ?? nhnResult?.header?.resultMessage;
        return NextResponse.json({
            success: status !== "failed",
            data: {
                status,
                requestId: nhnResult?.message?.requestId,
                resultCode: result?.resultCode ?? nhnResult?.header?.resultCode,
                resultMessage,
            },
            ...(status === "failed" && { error: `발송 실패: ${resultMessage || "공급자가 요청을 거절했습니다."}` }),
        });
    } catch (error) {
        console.error("Alimtalk test-send error:", error);
        return NextResponse.json({ success: false, error: "발송에 실패했습니다." }, { status: 500 });
    }
}
