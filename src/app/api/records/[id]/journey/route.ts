import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { buildRecordJourney } from "@/lib/tracker/journey";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const fromParam = sp.get("from");
    const toParam = sp.get("to");

    try {
        const data = await buildRecordJourney({
            recordId,
            orgId: user.orgId,
            channelFilter: sp.getAll("channel"), // business|tracker|email
            fromTs: fromParam ? new Date(fromParam).getTime() : null,
            toTs: toParam ? new Date(toParam).getTime() : null,
            merge: sp.get("merge") !== "none",
        });

        if (!data) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Journey fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
