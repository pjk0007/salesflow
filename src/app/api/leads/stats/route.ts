import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, workspaces } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { getLeadStats } from "@/lib/leads/stats";

// GET: 워크스페이스 리드 통계 (?workspaceId=&days=30|90|180|365 또는 &from=YYYY-MM-DD&to=YYYY-MM-DD, 없으면 전체)
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const workspaceId = Number(req.nextUrl.searchParams.get("workspaceId"));
    const sp = req.nextUrl.searchParams;
    const daysParam = Number(sp.get("days"));
    const days = [30, 90, 180, 365].includes(daysParam) ? daysParam : null;
    // 날짜는 한국 시간 하루 단위 — to는 그날 끝까지 포함
    const kstDay = (v: string | null, addDays = 0) => {
        if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
        const d = new Date(`${v}T00:00:00+09:00`);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + addDays * 24 * 60 * 60 * 1000);
    };
    const customFrom = kstDay(sp.get("from"));
    const customTo = kstDay(sp.get("to"), 1);
    const period = customFrom || customTo
        ? { from: customFrom, to: customTo }
        : { from: days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null, to: null };
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
        return NextResponse.json({ success: true, data: await getLeadStats(user.orgId, workspaceId, period) });
    } catch (error) {
        console.error("Lead stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
