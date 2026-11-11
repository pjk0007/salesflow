import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, workspaces } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";

// GET: 리드 대응상태 설정 — 리드 관리 화면에서 멤버도 읽는다 (저장은 워크스페이스 설정 PATCH, 관리자만)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const workspaceId = Number((await params).id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "워크스페이스 ID가 필요합니다." }, { status: 400 });
    }
    const [ws] = await db
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));
    if (!ws) {
        return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: ws.settings?.leadStatuses ?? null });
}
