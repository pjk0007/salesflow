import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    try {
        const pageNum = req.nextUrl.searchParams.get("pageNum") ? Number(req.nextUrl.searchParams.get("pageNum")) : undefined;
        const pageSize = req.nextUrl.searchParams.get("pageSize") ? Number(req.nextUrl.searchParams.get("pageSize")) : undefined;
        const result = await client.listSenders({ pageNum, pageSize });

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            data: {
                senders: result.senders,
                totalCount: result.totalCount,
            },
        });
    } catch (error) {
        console.error("Senders list error:", error);
        return NextResponse.json({ success: false, error: "발신프로필 조회에 실패했습니다." }, { status: 500 });
    }
}

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
        const { plusFriendId, phoneNo, categoryCode } = await req.json();
        if (!plusFriendId || !phoneNo || !categoryCode) {
            return NextResponse.json({
                success: false,
                error: "plusFriendId, phoneNo, categoryCode는 필수입니다.",
            }, { status: 400 });
        }

        const result = await client.registerSender({ plusFriendId, phoneNo, categoryCode });

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({
            success: true,
            message: "발신프로필 등록 요청이 완료되었습니다. 인증 토큰을 입력해주세요.",
        });
    } catch (error) {
        console.error("Sender register error:", error);
        return NextResponse.json({ success: false, error: "발신프로필 등록에 실패했습니다." }, { status: 500 });
    }
}
