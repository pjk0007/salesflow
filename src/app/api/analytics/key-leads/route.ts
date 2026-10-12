import { NextRequest, NextResponse } from "next/server";
import { queryClient } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { listAssessedLeads } from "@/lib/customer-journey-leads";

/** 구글챗에 사용한 최신 유효 판정을 사업·고객별로 한 번만 보여준다. */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const workspace = req.nextUrl.searchParams.get("workspaceId"), limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    if ((workspace !== null && (!Number.isSafeInteger(Number(workspace)) || Number(workspace) <= 0)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        return NextResponse.json({ success: false, error: "조회 조건을 확인해 주세요." }, { status: 400 });
    }
    const conn = await queryClient.reserve();
    try {
        const now = new Date();
        const leads = await listAssessedLeads(conn, { orgId: user.orgId, workspaceId: workspace ? Number(workspace) : undefined, limit, now });
        return NextResponse.json({ success: true, data: { leads, asOf: now.toISOString(), criteria: "구글챗과 동일한 최근 30일 고객 여정 판정 · 최신 유효 방문 기준" } });
    } catch {
        return NextResponse.json({ success: false, error: "핵심 리드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    } finally { conn.release(); }
}
