import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkSendLogs } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const logId = Number(id);
        if (!logId) {
            return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
        }

        const [log] = await db
            .select()
            .from(alimtalkSendLogs)
            .where(and(eq(alimtalkSendLogs.id, logId), eq(alimtalkSendLogs.orgId, user.orgId)))
            .limit(1);

        if (!log) {
            return NextResponse.json({ success: false, error: "발송 로그를 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: log });
    } catch (error) {
        console.error("Alimtalk log detail error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
