import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { removeLeadWorkspace } from "@/lib/leads/remove-workspace";

// DELETE: 리드관리에서 사업부 탭 빼기 — 리드가 없는 사업부의 빈 리드함·리드 폴더를 지운다 (관리자만)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "관리자만 사업부를 뺄 수 있습니다." }, { status: 403 });
    }
    const workspaceId = Number((await params).id);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "잘못된 사업부입니다." }, { status: 400 });
    }
    try {
        const result = await removeLeadWorkspace(user.orgId, workspaceId);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Lead workspace remove error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
