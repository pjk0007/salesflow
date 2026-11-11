import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, workspaces } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getLeadStats } from "@/lib/leads/stats";

// GET: 워크스페이스 리드 통계 (?workspaceId=&days=30|90|365, days 없으면 전체)
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const workspaceId = Number(req.nextUrl.searchParams.get("workspaceId"));
    const daysParam = Number(req.nextUrl.searchParams.get("days"));
    const days = [30, 90, 180, 365].includes(daysParam) ? daysParam : null;
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스를 선택해주세요." }, { status: 400 });
    }
    const [ws] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));
    if (!ws) {
        return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
    }
    try {
        return NextResponse.json({ success: true, data: await getLeadStats(user.orgId, workspaceId, days) });
    } catch (error) {
        console.error("Lead stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
