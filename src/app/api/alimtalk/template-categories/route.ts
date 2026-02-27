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
        const result = await client.getTemplateCategories();

        if (!result.header.isSuccessful) {
            return NextResponse.json({ success: false, error: result.header.resultMessage });
        }

        return NextResponse.json({ success: true, data: { groups: result.categories } });
    } catch (error) {
        console.error("Template categories error:", error);
        return NextResponse.json({ success: false, error: "카테고리 조회에 실패했습니다." }, { status: 500 });
    }
}
