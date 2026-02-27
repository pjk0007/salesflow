import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { NhnAlimtalkClient } from "@/lib/nhn-alimtalk";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { appKey, secretKey } = await req.json();
        if (!appKey || !secretKey) {
            return NextResponse.json({ success: false, error: "appKey와 secretKey는 필수입니다." }, { status: 400 });
        }

        const client = new NhnAlimtalkClient(appKey, secretKey);
        const result = await client.listSenders({ pageNum: 1, pageSize: 1 });

        if (result.header.isSuccessful) {
            return NextResponse.json({
                success: true,
                data: {
                    connected: true,
                    senderCount: result.totalCount,
                },
            });
        }

        return NextResponse.json({
            success: false,
            error: `NHN Cloud 연결 실패: ${result.header.resultMessage}`,
        });
    } catch (error) {
        console.error("Alimtalk connection test error:", error);
        return NextResponse.json({
            success: false,
            error: "NHN Cloud 연결에 실패했습니다. API 키를 확인해주세요.",
        });
    }
}
