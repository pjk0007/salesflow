import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getUsageData } from "@/lib/ai";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const data = await getUsageData(user.orgId);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("AI usage data error:", error);
        return NextResponse.json({ success: false, error: "사용량 조회에 실패했습니다." }, { status: 500 });
    }
}
