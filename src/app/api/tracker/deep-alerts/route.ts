import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { listDeepVisitorAlerts, describeDeepAlertError } from "@/lib/deep-visitor-alert";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/tracker/deep-alerts?limit=50 — 자기 조직의 최근 알림 줄 (카드 글자 포함)
export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    const limitParam = req.nextUrl.searchParams.get("limit");
    const raw = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
    const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw))) : DEFAULT_LIMIT;

    try {
        const rows = await listDeepVisitorAlerts(user.orgId, limit);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        console.error("[deep-alert] list error:", describeDeepAlertError(error));
        return NextResponse.json({ success: false, error: "알림 목록을 불러오지 못했습니다." }, { status: 500 });
    }
}
